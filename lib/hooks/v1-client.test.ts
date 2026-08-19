import { describe, expect, it, vi } from "vitest";
import type { ApiJobSummary } from "@/lib/api/contracts";
import {
  fetchV1Resource,
  getPollInterval,
  parseRetryAfter,
} from "./v1-client";

const queuedJob: ApiJobSummary = {
  id: "job-1",
  type: "watchlist",
  resourceKey: "watchlist:alice",
  status: "queued",
  attempts: 0,
  statusUrl: "/api/v1/jobs/job-1",
  createdAt: "2026-08-19T12:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  error: null,
};

const meta = {
  cache: "hit" as const,
  fetchedAt: "2026-08-19T12:00:00.000Z",
  staleAt: "2026-08-20T12:00:00.000Z",
};

describe("fetchV1Resource", () => {
  it("honors Retry-After, polls jobs, and refetches the resource", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: null,
            meta: { cache: "miss", jobs: [queuedJob] },
          },
          202,
          { "Retry-After": "3" }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            ...queuedJob,
            status: "succeeded",
            finishedAt: "2026-08-19T12:00:03.000Z",
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { value: 42 }, meta })
      );
    const delays: number[] = [];

    const result = await fetchV1Resource<{ value: number }>(
      "/api/v1/resource",
      {
        fetcher,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      }
    );

    expect(delays).toEqual([3_000]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/resource",
      "/api/v1/jobs/job-1",
      "/api/v1/resource",
    ]);
    expect(result.data.value).toBe(42);
  });

  it("uses capped exponential polling when no Retry-After is sent", async () => {
    const statuses = [
      "running",
      "running",
      "running",
      "running",
      "running",
      "succeeded",
    ] as const;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: null,
          meta: { cache: "miss", jobs: [queuedJob] },
        }, 202)
      );
    for (const status of statuses) {
      fetcher.mockResolvedValueOnce(
        jsonResponse({ data: { ...queuedJob, status } })
      );
    }
    fetcher.mockResolvedValueOnce(
      jsonResponse({ data: { films: [] }, meta })
    );
    const delays: number[] = [];

    await fetchV1Resource("/api/v1/overlap", {
      fetcher,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
  });

  it("times out after the configured deadline and remains recoverable", async () => {
    let clock = 0;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: null,
          meta: { cache: "miss", jobs: [queuedJob] },
        }, 202)
      )
      .mockResolvedValue(
        jsonResponse({ data: { ...queuedJob, status: "running" } })
      );

    const request = fetchV1Resource("/api/v1/overlap", {
      fetcher,
      timeoutMs: 2_500,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    await expect(request).rejects.toMatchObject({
      code: "timeout",
      recoverable: true,
    });
  });

  it("turns failed jobs into standardized recoverable errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: null,
          meta: { cache: "miss", jobs: [queuedJob] },
        }, 202)
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            ...queuedJob,
            status: "failed",
            error: {
              code: "upstream_unavailable",
              message: "Letterboxd is unavailable.",
            },
          },
        })
      );

    await expect(
      fetchV1Resource("/api/v1/overlap", {
        fetcher,
        sleep: async () => {},
      })
    ).rejects.toEqual(
      expect.objectContaining({
        name: "V1ApiError",
        code: "upstream_unavailable",
        message: "Letterboxd is unavailable.",
        recoverable: true,
      })
    );
  });

  it("cancels polling when the caller aborts", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          data: null,
          meta: { cache: "miss", jobs: [queuedJob] },
        },
        202
      )
    );

    await expect(
      fetchV1Resource("/api/v1/overlap", {
        fetcher,
        signal: controller.signal,
        onPending: () => controller.abort(),
        sleep: async (_milliseconds, signal) => {
          if (signal.aborted) throw signal.reason;
        },
      })
    ).rejects.toMatchObject({
      code: "cancelled",
      recoverable: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses standardized API error envelopes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "invalid_overlap_users",
            message: "Choose between 2 and 10 users.",
          },
        },
        400
      )
    );

    await expect(
      fetchV1Resource("/api/v1/overlap", { fetcher })
    ).rejects.toEqual(
      expect.objectContaining({
        code: "invalid_overlap_users",
        message: "Choose between 2 and 10 users.",
        recoverable: false,
      })
    );
  });
});

describe("poll timing helpers", () => {
  it("parses Retry-After seconds and dates", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    expect(parseRetryAfter("2.5", now)).toBe(2_500);
    expect(parseRetryAfter("Wed, 19 Aug 2026 12:00:04 GMT", now)).toBe(4_000);
    expect(parseRetryAfter("invalid", now)).toBeUndefined();
  });

  it("caps both exponential and server-provided intervals", () => {
    expect(getPollInterval(6, undefined)).toBe(10_000);
    expect(getPollInterval(0, 12_000)).toBe(10_000);
  });
});

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

