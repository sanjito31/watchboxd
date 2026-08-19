import { describe, expect, it, vi } from "vitest";
import type { ScrapeJob } from "@/lib/generated/prisma/client";
import { ProviderNotFoundError } from "@/lib/letterboxd/providerErrors";
import { RetryableJobError } from "./contracts";
import {
  processScrapeQueueMessage,
  queueRetryDirective,
} from "./consumer";
import type { JobWorkerRegistry } from "./workers";

const payload = {
  version: 1,
  jobId: "11111111-1111-4111-8111-111111111111",
} as const;

describe("queue consumer", () => {
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
});

describe("queueRetryDirective", () => {
  it("uses exponential retry and acknowledges exhausted deliveries", () => {
    expect(queueRetryDirective(new Error(), { deliveryCount: 1 })).toEqual({
      afterSeconds: 5,
    });
    expect(queueRetryDirective(new Error(), { deliveryCount: 4 })).toEqual({
      afterSeconds: 40,
    });
    expect(queueRetryDirective(new Error(), { deliveryCount: 5 })).toEqual({
      acknowledge: true,
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
  return {
    scrapeJob,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      events.push("transaction");
      return callback({ scrapeJob });
    }),
  } as never;
}

function profileWorkers(worker: {
  fetch: (identifier: string) => Promise<unknown>;
  persist: (...args: never[]) => Promise<void>;
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
