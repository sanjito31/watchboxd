import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeJob } from "@/lib/generated/prisma/client";
import { ProviderNotFoundError } from "@/lib/letterboxd/providerErrors";
import { RetryableJobError } from "./contracts";
import {
  processScrapeQueueMessage,
  queueRetryDirective,
} from "./consumer";
import type { JobWorkerRegistry } from "./workers";

const publishScrapeJob = vi.hoisted(() => vi.fn());
vi.mock("./publisher", () => ({ publishScrapeJob }));

const payload = {
  version: 1,
  jobId: "11111111-1111-4111-8111-111111111111",
} as const;

describe("queue consumer", () => {
  beforeEach(() => publishScrapeJob.mockReset());

  it("fetches upstream before the persistence transaction and succeeds", async () => {
    const events: string[] = [];
    const state = databaseJob();
    const prisma = fakePrisma(state, events);
    const workers = profileWorkers({
      fetch: async () => {
        events.push("fetch");
        return {};
      },
      persist: async () => {
        events.push("persist");
      },
    });

    await processScrapeQueueMessage(
      payload,
      { deliveryCount: 1, topicName: "scrape-jobs-v1" },
      { prisma, workers }
    );

    expect(events).toEqual(["fetch", "transaction", "persist"]);
    expect(state.status).toBe("SUCCEEDED");
    expect(state.attempts).toBe(1);
  });

  it("publishes durable child jobs only after the parent transaction commits", async () => {
    const events: string[] = [];
    const state = databaseJob();
    const prisma = fakePrisma(state, events);
    const child = {
      id: "22222222-2222-4222-8222-222222222222",
      environment: "preview",
      type: "movie",
      resourceKey: "movie:interstellar",
      status: "queued",
      attempts: 0,
      queueMessageId: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as const;
    publishScrapeJob.mockImplementation(async () => {
      expect(state.status).toBe("SUCCEEDED");
      events.push("publish");
      return child;
    });

    await processScrapeQueueMessage(
      payload,
      { deliveryCount: 1, topicName: "scrape-jobs-v1" },
      {
        prisma,
        workers: profileWorkers({
          fetch: async () => ({}),
          persist: async () => [child],
        }),
      }
    );

    expect(events).toEqual(["transaction", "publish"]);
    expect(publishScrapeJob).toHaveBeenCalledWith(child, { client: prisma });
  });

  it("skips already-succeeded redeliveries", async () => {
    const state = databaseJob({ status: "SUCCEEDED" });
    const fetch = vi.fn();

    await processScrapeQueueMessage(
      payload,
      { deliveryCount: 2, topicName: "scrape-jobs-v1" },
      {
        prisma: fakePrisma(state),
        workers: profileWorkers({ fetch, persist: vi.fn() }),
      }
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(state.attempts).toBe(0);
  });

  it("retries instead of acknowledging a delivery with a fresh running row", async () => {
    const state = databaseJob({
      status: "RUNNING",
      startedAt: new Date(),
    });
    const prisma = fakePrisma(state);
    (
      prisma as unknown as {
        scrapeJob: { updateMany: ReturnType<typeof vi.fn> };
      }
    ).scrapeJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      processScrapeQueueMessage(
        payload,
        { deliveryCount: 5, topicName: "scrape-jobs-v1" },
        { prisma }
      )
    ).rejects.toMatchObject({
      name: "QueueDeliveryRetryError",
      retryAfterSeconds: 30,
    });
  });

  it("records a transient error and throws for queue redelivery", async () => {
    const state = databaseJob();

    await expect(
      processScrapeQueueMessage(
        payload,
        { deliveryCount: 1, topicName: "scrape-jobs-v1" },
        {
          prisma: fakePrisma(state),
          workers: profileWorkers({
            fetch: async () => {
              throw new RetryableJobError("temporary");
            },
            persist: vi.fn(),
          }),
        }
      )
    ).rejects.toMatchObject({ name: "QueueDeliveryRetryError" });

    expect(state.status).toBe("QUEUED");
    expect(state.errorCode).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("acknowledges deterministic Prisma void-result failures without retrying", async () => {
    const state = databaseJob();
    const error = Object.assign(
      new Error(
        "Raw query failed. Failed to deserialize column of type 'void'."
      ),
      { code: "P2010" }
    );

    await expect(
      processScrapeQueueMessage(
        payload,
        { deliveryCount: 1, topicName: "scrape-jobs-v1" },
        {
          prisma: fakePrisma(state),
          workers: profileWorkers({
            fetch: async () => ({}),
            persist: async () => {
              throw error;
            },
          }),
        }
      )
    ).resolves.toBeUndefined();

    expect(state.status).toBe("FAILED");
    expect(state.errorCode).toBe("UNKNOWN");
    expect(state.attempts).toBe(1);
  });

  it("acknowledges and preserves a failed row on the fifth delivery", async () => {
    const state = databaseJob();

    await expect(
      processScrapeQueueMessage(
        payload,
        { deliveryCount: 5, topicName: "scrape-jobs-v1" },
        {
          prisma: fakePrisma(state),
          workers: profileWorkers({
            fetch: async () => {
              throw new Error("poison payload");
            },
            persist: vi.fn(),
          }),
        }
      )
    ).resolves.toBeUndefined();

    expect(state.status).toBe("FAILED");
    expect(state.errorCode).toBe("ATTEMPTS_EXHAUSTED");
  });

  it("acknowledges upstream 404s without retrying", async () => {
    const state = databaseJob();

    await processScrapeQueueMessage(
      payload,
      { deliveryCount: 1, topicName: "scrape-jobs-v1" },
      {
        prisma: fakePrisma(state),
        workers: profileWorkers({
          fetch: async () => {
            throw new ProviderNotFoundError("missing");
          },
          persist: vi.fn(),
        }),
      }
    );

    expect(state.status).toBe("FAILED");
    expect(state.errorCode).toBe("NOT_FOUND");
  });

  it("marks only pending movies failed on a terminal movie error", async () => {
    const state = databaseJob({
      type: "MOVIE",
      resourceKey: "movie:missing-film",
    });
    const prisma = fakePrisma(state) as never as {
      movie: { updateMany: ReturnType<typeof vi.fn> };
    };

    await processScrapeQueueMessage(
      payload,
      { deliveryCount: 1, topicName: "scrape-jobs-v1" },
      {
        prisma: prisma as never,
        workers: {
          movie: {
            fetch: async () => {
              throw new ProviderNotFoundError("missing");
            },
            persist: vi.fn(),
          },
        } as unknown as JobWorkerRegistry,
      }
    );

    expect(prisma.movie.updateMany).toHaveBeenCalledWith({
      where: {
        resolutionStatus: "PENDING",
        OR: [
          { letterboxdSlug: "missing-film" },
          { aliases: { some: { slug: "missing-film" } } },
        ],
      },
      data: { resolutionStatus: "FAILED" },
    });
  });
});

describe("queueRetryDirective", () => {
  it("keeps retrying thrown failures so bookkeeping errors cannot strand jobs", () => {
    expect(queueRetryDirective(new Error(), { deliveryCount: 1 })).toEqual({
      afterSeconds: 5,
    });
    expect(queueRetryDirective(new Error(), { deliveryCount: 4 })).toEqual({
      afterSeconds: 40,
    });
    expect(queueRetryDirective(new Error(), { deliveryCount: 5 })).toEqual({
      afterSeconds: 80,
    });
  });
});

function fakePrisma(state: ScrapeJob, events: string[] = []) {
  const scrapeJob = {
    findUnique: vi.fn(async () => ({ ...state })),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (
        typeof data.attempts === "object" &&
        data.attempts &&
        "increment" in data.attempts
      ) {
        state.attempts += Number(
          (data.attempts as { increment: number }).increment
        );
      }
      for (const [key, value] of Object.entries(data)) {
        if (key !== "attempts") {
          (state as unknown as Record<string, unknown>)[key] = value;
        }
      }
      return { count: 1 };
    }),
  };
  const movie = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
  return {
    scrapeJob,
    movie,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      events.push("transaction");
      return callback({ scrapeJob, movie });
    }),
  } as never;
}

function profileWorkers(worker: {
  fetch: (identifier: string) => Promise<unknown>;
  persist: (...args: never[]) => Promise<unknown>;
}): JobWorkerRegistry {
  return {
    profile: worker,
  } as unknown as JobWorkerRegistry;
}

function databaseJob(overrides: Partial<ScrapeJob> = {}): ScrapeJob {
  const now = new Date("2026-08-19T16:00:00.000Z");
  return {
    id: payload.jobId,
    environment: "PREVIEW",
    type: "PROFILE",
    resourceKey: "profile:alice",
    status: "QUEUED",
    attempts: 0,
    queueMessageId: "message-1",
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
