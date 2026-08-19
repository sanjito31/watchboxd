import { describe, expect, it, vi } from "vitest";
import type { ScrapeJob } from "@/lib/generated/prisma/client";
import {
  claimJobDelivery,
  createOrReuseJob,
  type JobClient,
} from "./repository";

const identity = {
  environment: "preview",
  type: "watchlist",
  resourceKey: "watchlist:alice",
} as const;

describe("createOrReuseJob", () => {
  it("creates a normalized active job", async () => {
    const row = databaseJob();
    const client = fakeClient({
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(row),
    });

    const result = await createOrReuseJob(identity, { client });

    expect(result.created).toBe(true);
    expect(result.shouldPublish).toBe(true);
    expect(result.job).toMatchObject({
      environment: "preview",
      type: "watchlist",
      status: "queued",
    });
    expect(client.scrapeJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        environment: "PREVIEW",
        type: "WATCHLIST",
        resourceKey: "watchlist:alice",
      }),
    });
  });

  it("reuses the row selected by the partial unique index", async () => {
    const row = databaseJob();
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row);
    const client = fakeClient({
      findFirst,
      create: vi.fn().mockRejectedValue({ code: "P2002" }),
    });

    const result = await createOrReuseJob(identity, {
      client,
      now: new Date(row.updatedAt.getTime() + 30_000),
    });

    expect(result.created).toBe(false);
    expect(result.shouldPublish).toBe(false);
    expect(result.job.id).toBe(row.id);
  });

  it("requests republishing after one minute without a message id", async () => {
    const row = databaseJob();
    const client = fakeClient({
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row),
      create: vi.fn().mockRejectedValue({ code: "P2002" }),
    });

    const result = await createOrReuseJob(identity, {
      client,
      now: new Date(row.updatedAt.getTime() + 60_000),
    });

    expect(result.shouldPublish).toBe(true);
  });

  it("uses a recent not-found failure as a one-hour negative cache", async () => {
    const row = databaseJob({
      status: "FAILED",
      errorCode: "NOT_FOUND",
      errorMessage: "Not found",
      finishedAt: new Date(),
    });
    const client = fakeClient({
      findFirst: vi.fn().mockResolvedValue(row),
      create: vi.fn(),
    });

    const result = await createOrReuseJob(identity, { client });

    expect(result.created).toBe(false);
    expect(result.shouldPublish).toBe(false);
    expect(client.scrapeJob.create).not.toHaveBeenCalled();
  });

  it("rejects mismatched type and canonical key", async () => {
    await expect(
      createOrReuseJob(
        { ...identity, resourceKey: "movie:alice" as "watchlist:alice" },
        { client: fakeClient() }
      )
    ).rejects.toThrow("do not match");
  });
});

describe("claimJobDelivery", () => {
  it("does not process a concurrent running delivery", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const client = fakeClient({
      updateMany,
      findUnique: vi.fn().mockResolvedValue(databaseJob({ status: "RUNNING" })),
    });

    await expect(claimJobDelivery(databaseJob().id, client)).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: databaseJob().id,
        OR: [
          { status: "QUEUED" },
          {
            status: "RUNNING",
            startedAt: { lte: expect.any(Date) },
          },
        ],
      },
      data: expect.objectContaining({
        status: "RUNNING",
        attempts: { increment: 1 },
      }),
    });
  });
});

function fakeClient(overrides: Record<string, unknown> = {}): JobClient {
  return {
    scrapeJob: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides,
    },
  } as unknown as JobClient;
}

function databaseJob(overrides: Partial<ScrapeJob> = {}): ScrapeJob {
  const now = new Date("2026-08-19T16:00:00.000Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    environment: "PREVIEW",
    type: "WATCHLIST",
    resourceKey: "watchlist:alice",
    status: "QUEUED",
    attempts: 0,
    queueMessageId: null,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
