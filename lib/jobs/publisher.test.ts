import { DuplicateMessageError } from "@vercel/queue";
import { describe, expect, it, vi } from "vitest";
import type { ScrapeJob } from "@/lib/generated/prisma/client";
import { publishScrapeJob } from "./publisher";
import type { JobClient, JobRecord } from "./repository";

describe("publishScrapeJob", () => {
  it("uses the database UUID as idempotency key and stores the message id", async () => {
    const state = databaseJob();
    const client = statefulClient(state);
    const send = vi.fn().mockResolvedValue({ messageId: "queue-message-1" });

    const result = await publishScrapeJob(jobRecord(), { client, send });

    expect(send).toHaveBeenCalledWith(
      "scrape-jobs-v1",
      {
        version: 1,
        jobId: "11111111-1111-4111-8111-111111111111",
      },
      {
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        retentionSeconds: 604_800,
      }
    );
    expect(result.queueMessageId).toBe("queue-message-1");
  });

  it("treats an idempotency collision as an already-published message", async () => {
    const state = databaseJob();
    const client = statefulClient(state);
    const send = vi
      .fn()
      .mockRejectedValue(new DuplicateMessageError("duplicate", state.id));

    await expect(
      publishScrapeJob(jobRecord(), { client, send })
    ).resolves.toMatchObject({ status: "queued" });
    expect(state.status).toBe("QUEUED");
  });

  it("records a sanitized failed row when publication fails", async () => {
    const state = databaseJob();
    const client = statefulClient(state);
    const send = vi
      .fn()
      .mockRejectedValue(new Error("token=secret-value\nqueue unavailable"));

    await expect(
      publishScrapeJob(jobRecord(), { client, send })
    ).rejects.toMatchObject({
      name: "QueuePublicationError",
      job: { status: "failed" },
    });
    expect(state.status).toBe("FAILED");
    expect(state.errorMessage).not.toContain("secret-value");
  });
});

function statefulClient(state: ScrapeJob): JobClient {
  return {
    scrapeJob: {
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state, data);
        return { count: 1 };
      }),
      findUnique: vi.fn(async () => ({ ...state })),
    },
  } as unknown as JobClient;
}

function databaseJob(): ScrapeJob {
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
  };
}

function jobRecord(): JobRecord {
  const row = databaseJob();
  return {
    ...row,
    environment: "preview",
    type: "watchlist",
    resourceKey: "watchlist:alice",
    status: "queued",
    error: null,
  };
}
