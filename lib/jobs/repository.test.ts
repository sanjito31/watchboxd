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
const developmentIdentity = { ...identity, environment: "development" } as const;

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

  it("expires an unclaimed queued row and creates a replacement job", async () => {
    const stale = databaseJob({
      environment: "DEVELOPMENT",
      queueMessageId: "missing-message",
    });
    const replacement = databaseJob({
      id: "22222222-2222-4222-8222-222222222222",
      environment: "DEVELOPMENT",
      createdAt: new Date("2026-08-19T16:00:15.000Z"),
      updatedAt: new Date("2026-08-19T16:00:15.000Z"),
    });
    const client = fakeClient({
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(stale),
      create: vi
        .fn()
        .mockRejectedValueOnce({ code: "P2002" })
        .mockResolvedValueOnce(replacement),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    });

    const result = await createOrReuseJob(developmentIdentity, {
      client,
      now: new Date(stale.updatedAt.getTime() + 15_000),
    });

    expect(result).toMatchObject({
      created: true,
      shouldPublish: true,
      job: { id: replacement.id, status: "queued" },
    });
    expect(client.scrapeJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: stale.id,
        status: "QUEUED",
        attempts: 0,
        updatedAt: { lte: new Date("2026-08-19T16:00:00.000Z") },
      },
      data: expect.objectContaining({
        status: "FAILED",
        errorCode: "TIMEOUT",
        finishedAt: new Date("2026-08-19T16:00:15.000Z"),
      }),
    });
  });

  it("keeps a deployed queued job during its five-minute delivery lease", async () => {
    const row = databaseJob({ queueMessageId: "message-1" });
    const client = fakeClient({
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row),
      create: vi.fn().mockRejectedValue({ code: "P2002" }),
      updateMany: vi.fn(),
    });

    const result = await createOrReuseJob(identity, {
      client,
      now: new Date(row.updatedAt.getTime() + 60_000),
    });

    expect(result).toMatchObject({ created: false, shouldPublish: false });
    expect(client.scrapeJob.updateMany).not.toHaveBeenCalled();
  });

  it("does not expire a queued row that has already been delivered", async () => {
    const row = databaseJob({ attempts: 1, queueMessageId: "message-1" });
    const client = fakeClient({
      findFirst: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row),
      create: vi.fn().mockRejectedValue({ code: "P2002" }),
      updateMany: vi.fn(),
    });

    const result = await createOrReuseJob(identity, {
      client,
      now: new Date(row.updatedAt.getTime() + 60_000),
    });

    expect(result).toMatchObject({
      created: false,
      shouldPublish: false,
      job: { id: row.id, attempts: 1 },
    });
    expect(client.scrapeJob.updateMany).not.toHaveBeenCalled();
  });

  it("expires a stale running row and creates a replacement job", async () => {
    const startedAt = new Date("2026-08-19T15:50:00.000Z");
    const stale = databaseJob({ status: "RUNNING", startedAt });
    const replacement = databaseJob({
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: new Date("2026-08-19T16:00:00.000Z"),
      updatedAt: new Date("2026-08-19T16:00:00.000Z"),
    });
    const client = fakeClient({
      findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(stale),
      create: vi
        .fn()
        .mockRejectedValueOnce({ code: "P2002" })
        .mockResolvedValueOnce(replacement),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    });

    const result = await createOrReuseJob(identity, {
      client,
      now: new Date("2026-08-19T16:00:00.000Z"),
    });

    expect(result).toMatchObject({
      created: true,
      shouldPublish: true,
      job: { id: replacement.id, status: "queued" },
    });
    expect(client.scrapeJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: stale.id,
        status: "RUNNING",
        startedAt: { lte: new Date("2026-08-19T15:55:00.000Z") },
      },
      data: expect.objectContaining({
        status: "FAILED",
        errorCode: "TIMEOUT",
        finishedAt: new Date("2026-08-19T16:00:00.000Z"),
      }),
    });
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
