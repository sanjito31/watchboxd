import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getWatchlist: vi.fn(),
  getWatched: vi.fn(),
  getNetwork: vi.fn(),
  getMovie: vi.fn(),
  getMovieByLetterboxdSlug: vi.fn(),
  getOverlap: vi.fn(),
  getWatchedOverlap: vi.fn(),
  getJob: vi.fn(),
  requestJob: vi.fn(),
}));

vi.mock("@/lib/api/runtime", () => ({
  apiService: serviceMocks,
}));

import {
  OPTIONS,
  getJob,
  getMovie,
  getMovieByLetterboxdSlug,
  getOverlap,
  getProfile,
  getWatched,
  getWatchedOverlap,
  getWatchlist,
  manualJobOptions,
  postJob,
} from "@/lib/api/handlers";

const JOB_ID = "00000000-0000-4000-8000-000000000001";
const job = {
  id: JOB_ID,
  type: "profile" as const,
  resourceKey: "profile:alice" as const,
  status: "queued" as const,
  attempts: 0,
  statusUrl: `/api/v1/jobs/${JOB_ID}`,
  createdAt: "2026-08-19T16:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  error: null,
};

describe("v1 route handlers", () => {
  const previousOrigins = process.env.API_ALLOWED_ORIGINS;
  const previousManualJobApiKey = process.env.MANUAL_JOB_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_ALLOWED_ORIGINS =
      "https://app.example, https://other.example";
    process.env.MANUAL_JOB_API_KEY = "test-manual-job-secret";
  });

  afterEach(() => {
    if (previousOrigins === undefined) {
      delete process.env.API_ALLOWED_ORIGINS;
    } else {
      process.env.API_ALLOWED_ORIGINS = previousOrigins;
    }
    if (previousManualJobApiKey === undefined) {
      delete process.env.MANUAL_JOB_API_KEY;
    } else {
      process.env.MANUAL_JOB_API_KEY = previousManualJobApiKey;
    }
  });

  it("sets configured CORS and Vary headers on preflight", async () => {
    const response = OPTIONS(
      request("https://api.example/api/v1/overlap", {
        method: "OPTIONS",
        headers: { Origin: "https://app.example" },
      })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example"
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, OPTIONS"
    );
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("omits allow-origin for a disallowed origin", () => {
    const response = OPTIONS(
      request("https://api.example/api/v1/overlap", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      })
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("advertises POST and Authorization for manual-job preflight", () => {
    const response = manualJobOptions(
      request("https://api.example/api/v1/jobs", { method: "OPTIONS" })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Authorization, Content-Type"
    );
  });

  it("requires the configured bearer token for manual jobs", async () => {
    const response = await postJob(
      request("https://api.example/api/v1/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "watched", identifier: "alice" }),
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
    expect(serviceMocks.requestJob).not.toHaveBeenCalled();
  });

  it("queues a normalized manual watched refresh even when cache is fresh", async () => {
    const watchedJob = {
      ...job,
      type: "watched" as const,
      resourceKey: "watched:alice" as const,
    };
    serviceMocks.requestJob.mockResolvedValue({
      data: null,
      meta: { cache: "miss", jobs: [watchedJob] },
    });

    const response = await postJob(
      request("https://api.example/api/v1/jobs", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-manual-job-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "watched", identifier: " Alice " }),
      })
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(watchedJob.statusUrl);
    expect(serviceMocks.requestJob).toHaveBeenCalledWith("watched", "alice");
  });

  it("queues a manual TMDB metadata enrichment job", async () => {
    const metadataJob = {
      ...job,
      type: "movie_metadata" as const,
      resourceKey: "movie_metadata:tmdb_157336" as const,
    };
    serviceMocks.requestJob.mockResolvedValue({
      data: null,
      meta: { cache: "miss", jobs: [metadataJob] },
    });

    const response = await postJob(
      request("https://api.example/api/v1/jobs", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-manual-job-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "movie_metadata",
          identifier: "TMDB_157336",
        }),
      })
    );

    expect(response.status).toBe(202);
    expect(serviceMocks.requestJob).toHaveBeenCalledWith(
      "movie_metadata",
      "tmdb_157336"
    );
  });

  it("rejects invalid manual-job JSON before queue access", async () => {
    const response = await postJob(
      request("https://api.example/api/v1/jobs", {
        method: "POST",
        headers: { Authorization: "Bearer test-manual-job-secret" },
        body: "not-json",
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_request" },
    });
    expect(serviceMocks.requestJob).not.toHaveBeenCalled();
  });

  it("returns 202 polling headers and normalized resource keys", async () => {
    serviceMocks.getProfile.mockResolvedValue({
      data: null,
      meta: { cache: "miss", jobs: [job] },
    });

    const response = await getProfile(
      request("https://api.example/api/v1/users/Alice"),
      { params: Promise.resolve({ username: " Alice " }) }
    );

    expect(serviceMocks.getProfile).toHaveBeenCalledWith("alice");
    expect(response.status).toBe(202);
    expect(response.headers.get("Location")).toBe(job.statusUrl);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("rejects page sizes over 100 before repository access", async () => {
    const response = await getWatchlist(
      request(
        "https://api.example/api/v1/users/alice/watchlist?page=1&pageSize=101"
      ),
      { params: Promise.resolve({ username: "alice" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_pagination",
        message: "pageSize must be at most 100",
      },
    });
    expect(serviceMocks.getWatchlist).not.toHaveBeenCalled();
  });

  it.each(["watchlist", "watched"] as const)(
    "returns a 200 partial %s response without polling movie jobs",
    async (kind) => {
      const result = {
        data: {
          user: { username: "alice", displayName: null, avatarUrl: null },
          items: [
            {
              position: 0,
              ...(kind === "watched" ? { userRating: 4.5 } : {}),
              movie: {
                letterboxdSlug: "waiting",
                title: "Waiting",
                year: 2026,
                letterboxdFilmId: null,
                tmdbId: null,
                letterboxdPoster: "https://a.ltrbxd.com/waiting.jpg",
                letterboxdRating: null,
              },
            },
          ],
          filmCount: 1,
          pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
        },
        meta: {
          cache: "hit",
          fetchedAt: "2026-08-19T15:00:00.000Z",
          staleAt: "2026-08-20T15:00:00.000Z",
          refreshJobs: [],
          enrichment: {
            complete: false,
            pendingSlugs: ["waiting"],
            failedSlugs: [],
          },
        },
      };
      const service =
        kind === "watchlist"
          ? serviceMocks.getWatchlist
          : serviceMocks.getWatched;
      service.mockResolvedValue(result);
      const handler = kind === "watchlist" ? getWatchlist : getWatched;

      const response = await handler(
        request(`https://api.example/api/v1/users/alice/${kind}`),
        { params: Promise.resolve({ username: "alice" }) }
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);
      expect(service).toHaveBeenCalledWith(
        "alice",
        expect.objectContaining({
          page: 1,
          pageSize: 50,
          includeMetadata: false,
          filters: expect.objectContaining({ genreMode: "any" }),
        })
      );
    }
  );

  it("parses shared metadata filters independently from response shaping", async () => {
    serviceMocks.getWatchlist.mockResolvedValue({
      data: {
        user: { username: "alice", displayName: null, avatarUrl: null },
        items: [],
        filmCount: 0,
        pagination: { page: 2, pageSize: 25, total: 0, totalPages: 1 },
      },
      meta: {
        cache: "hit",
        fetchedAt: "2026-08-19T15:00:00.000Z",
        staleAt: "2026-08-20T15:00:00.000Z",
        refreshJobs: [],
      },
    });

    await getWatchlist(
      request(
        "https://api.example/api/v1/users/alice/watchlist?page=2&pageSize=25&includeMetadata=false&title=star&year=2014&runtimeMin=120&runtimeMax=180&releaseDateFrom=2014-01-01&releaseDateTo=2014-12-31&originalLanguage=en&tmdbRatingMin=7.5&letterboxdRatingMax=4.5&genreIds=12,18&genres=Science%20Fiction&genreMode=all"
      ),
      { params: Promise.resolve({ username: "alice" }) }
    );

    expect(serviceMocks.getWatchlist).toHaveBeenCalledWith("alice", {
      page: 2,
      pageSize: 25,
      includeMetadata: false,
      filters: {
        title: "star",
        letterboxdSlug: undefined,
        letterboxdFilmId: undefined,
        tmdbId: undefined,
        year: 2014,
        runtimeMin: 120,
        runtimeMax: 180,
        releaseDateFrom: new Date("2014-01-01T00:00:00.000Z"),
        releaseDateTo: new Date("2014-12-31T00:00:00.000Z"),
        originalLanguage: "en",
        tmdbRatingMin: 7.5,
        tmdbRatingMax: undefined,
        letterboxdRatingMin: undefined,
        letterboxdRatingMax: 4.5,
        genreIds: [12, 18],
        genreNames: ["science fiction"],
        genreMode: "all",
      },
    });
  });

  it("rejects inverted filter ranges before service access", async () => {
    const response = await getWatched(
      request(
        "https://api.example/api/v1/users/alice/watched?runtimeMin=180&runtimeMax=90"
      ),
      { params: Promise.resolve({ username: "alice" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_request", message: expect.stringContaining("runtime") },
    });
    expect(serviceMocks.getWatched).not.toHaveBeenCalled();
  });

  it("passes a validated TMDB ID to the movie service", async () => {
    serviceMocks.getMovie.mockResolvedValue({
      data: null,
      meta: { cache: "miss", jobs: [job] },
    });

    const response = await getMovie(
      request("https://api.example/api/v1/movies/157336"),
      { params: Promise.resolve({ tmdbId: "157336" }) }
    );

    expect(response.status).toBe(202);
    expect(serviceMocks.getMovie).toHaveBeenCalledWith(157336);
  });

  it("rejects a non-numeric movie path before service access", async () => {
    const response = await getMovie(
      request("https://api.example/api/v1/movies/interstellar"),
      { params: Promise.resolve({ tmdbId: "interstellar" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_tmdb_id",
        message: "TMDB movie ID must be a positive integer",
      },
    });
    expect(serviceMocks.getMovie).not.toHaveBeenCalled();
  });

  it("rejects TMDB IDs that cannot fit the database integer column", async () => {
    const response = await getMovie(
      request("https://api.example/api/v1/movies/2147483648"),
      { params: Promise.resolve({ tmdbId: "2147483648" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_tmdb_id" },
    });
    expect(serviceMocks.getMovie).not.toHaveBeenCalled();
  });

  it("normalizes a Letterboxd slug for the fallback movie endpoint", async () => {
    serviceMocks.getMovieByLetterboxdSlug.mockResolvedValue({
      data: null,
      meta: { cache: "miss", jobs: [job] },
    });

    const response = await getMovieByLetterboxdSlug(
      request("https://api.example/api/v1/movies/letterboxd/interstellar"),
      { params: Promise.resolve({ letterboxdSlug: " Interstellar " }) }
    );

    expect(response.status).toBe(202);
    expect(serviceMocks.getMovieByLetterboxdSlug).toHaveBeenCalledWith(
      "interstellar"
    );
  });

  it("rejects an invalid Letterboxd slug before service access", async () => {
    const response = await getMovieByLetterboxdSlug(
      request("https://api.example/api/v1/movies/letterboxd/bad%20slug"),
      { params: Promise.resolve({ letterboxdSlug: "bad slug" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_movie_slug" },
    });
    expect(serviceMocks.getMovieByLetterboxdSlug).not.toHaveBeenCalled();
  });

  it("normalizes overlap users and enforces 2 to 10 unique users", async () => {
    serviceMocks.getOverlap.mockResolvedValue({
      data: {
        users: [],
        films: [],
        pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
      },
      meta: {
        cache: "hit",
        fetchedAt: "2026-08-19T15:00:00.000Z",
        staleAt: "2026-08-20T15:00:00.000Z",
      },
    });

    const valid = await getOverlap(
      request(
        "https://api.example/api/v1/overlap?users=Alice,bob,alice&page=1&pageSize=10"
      )
    );
    const invalid = await getOverlap(
      request("https://api.example/api/v1/overlap?users=alice,alice")
    );

    expect(valid.status).toBe(200);
    expect(serviceMocks.getOverlap).toHaveBeenCalledWith(
      ["alice", "bob"],
      expect.objectContaining({ page: 1, pageSize: 10 })
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "invalid_overlap_users" },
    });
  });

  it("parses watched-overlap rating semantics", async () => {
    serviceMocks.getWatchedOverlap.mockResolvedValue({
      data: {
        users: [],
        films: [],
        pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
      },
      meta: {
        cache: "hit",
        fetchedAt: "2026-08-19T15:00:00.000Z",
        staleAt: "2026-08-20T15:00:00.000Z",
        refreshJobs: [],
      },
    });

    const response = await getWatchedOverlap(
      request(
        "https://api.example/api/v1/overlap/watched?users=alice,bob&includeMetadata=true&userRatingMin=3.5&userRatingMax=5&ratingMode=all"
      )
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.getWatchedOverlap).toHaveBeenCalledWith(
      ["alice", "bob"],
      expect.objectContaining({
        includeMetadata: true,
        userRatingMin: 3.5,
        userRatingMax: 5,
        ratingMode: "all",
      })
    );
  });

  it("returns normalized polling status and 404 for unknown jobs", async () => {
    serviceMocks.getJob.mockResolvedValueOnce({ data: job }).mockResolvedValueOnce({
      error: { code: "job_not_found", message: "Job not found" },
    });

    const found = await getJob(
      request(`https://api.example/api/v1/jobs/${JOB_ID}`),
      { params: Promise.resolve({ jobId: JOB_ID }) }
    );
    const missing = await getJob(
      request(
        "https://api.example/api/v1/jobs/00000000-0000-4000-8000-000000000002"
      ),
      {
        params: Promise.resolve({
          jobId: "00000000-0000-4000-8000-000000000002",
        }),
      }
    );

    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ data: job });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: "job_not_found", message: "Job not found" },
    });
  });

  it("maps durable queue publication failures to 503", async () => {
    serviceMocks.getProfile.mockResolvedValue({
      error: {
        code: "upstream_unavailable",
        message: "The upstream service is temporarily unavailable",
      },
    });

    const response = await getProfile(
      request("https://api.example/api/v1/users/alice"),
      { params: Promise.resolve({ username: "alice" }) }
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "upstream_unavailable",
        message: "The upstream service is temporarily unavailable",
      },
    });
  });

  it("does not expose thrown upstream error bodies or stacks", async () => {
    serviceMocks.getProfile.mockRejectedValue(
      new Error("Bearer super-secret\nupstream body")
    );

    const response = await getProfile(
      request("https://api.example/api/v1/users/alice"),
      { params: Promise.resolve({ username: "alice" }) }
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).toBe(
      '{"error":{"code":"internal_error","message":"The request could not be completed"}}'
    );
    expect(serialized).not.toContain("super-secret");
  });
});

function request(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}
