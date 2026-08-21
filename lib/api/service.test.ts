import { describe, expect, it, vi } from "vitest";
import { ApiService } from "./service";
import type {
  ApiRepository,
  CacheStamp,
  JobGateway,
  MovieRecord,
  StoredJobRecord,
  UserListRecord,
  UserRecord,
} from "./types";

const now = new Date("2026-08-20T12:00:00.000Z");
const fresh = {
  fetchedAt: new Date("2026-08-20T10:00:00.000Z"),
  staleAt: new Date("2026-08-21T10:00:00.000Z"),
};
const stale = {
  fetchedAt: new Date("2026-08-18T10:00:00.000Z"),
  staleAt: new Date("2026-08-19T10:00:00.000Z"),
};

describe("ApiService Letterboxd movie cache", () => {
  it.each(["watchlist", "watched"] as const)(
    "returns 202 until the %s snapshot itself is available",
    async (kind) => {
      const repository = fakeRepository();
      const jobs = fakeJobs();
      const service = new ApiService(repository, jobs, () => now);

      const response =
        kind === "watchlist"
          ? await service.getWatchlist("alice", 1, 10)
          : await service.getWatched("alice", 1, 10);

      expect(response).toMatchObject({
        data: null,
        meta: {
          cache: "miss",
          jobs: [{ resourceKey: `${kind}:alice` }],
        },
      });
      expect(jobs.ensureJob).toHaveBeenCalledWith(kind, "alice");
    }
  );

  it("keeps failed movie enrichment in watchlist pagination", async () => {
    const repository = fakeRepository();
    repository.getWatchlist = vi.fn().mockResolvedValue(
      list([
        movie("gone", "failed"),
        movie("resolved", "resolved"),
        movie("resolved-two", "resolved"),
      ])
    );
    const jobs = fakeJobs();
    const response = await new ApiService(repository, jobs, () => now).getWatchlist(
      "alice",
      1,
      1
    );

    expect("data" in response && response.data).toMatchObject({
      filmCount: 3,
      pagination: { total: 3, totalPages: 3 },
      items: [{ position: 0, movie: { letterboxdSlug: "gone" } }],
    });
    expect("meta" in response && response.meta).toMatchObject({
      enrichment: {
        complete: false,
        pendingSlugs: [],
        failedSlugs: ["gone"],
      },
    });
    expect(jobs.ensureJob).not.toHaveBeenCalled();
  });

  it.each(["watchlist", "watched"] as const)(
    "returns a completed %s snapshot without checking child jobs",
    async (kind) => {
      const repository = fakeRepository();
      const pending = {
        ...movie("waiting", "pending"),
        letterboxdFilmId: null,
        tmdbId: null,
        letterboxdRating: null,
        letterboxd: { fetchedAt: null, staleAt: null },
      } satisfies MovieRecord;
      const snapshot = list([
        movie("ready", "resolved"),
        pending,
        movie("unavailable", "failed", { fetchedAt: null, staleAt: null }),
      ]);
      if (kind === "watchlist") {
        repository.getWatchlist = vi.fn().mockResolvedValue(snapshot);
      } else {
        repository.getWatched = vi.fn().mockResolvedValue(snapshot);
      }
      const jobs = fakeJobs();
      const service = new ApiService(repository, jobs, () => now);
      const response =
        kind === "watchlist"
          ? await service.getWatchlist("alice", 1, 10)
          : await service.getWatched("alice", 1, 10);

      expect(response).toMatchObject({
        data: {
          filmCount: 3,
          pagination: { total: 3, totalPages: 1 },
          items: [
            { movie: { letterboxdSlug: "ready" } },
            {
              movie: {
                letterboxdSlug: "waiting",
                tmdbId: null,
                letterboxdFilmId: null,
                letterboxdRating: null,
              },
            },
            { movie: { letterboxdSlug: "unavailable" } },
          ],
        },
        meta: {
          cache: "hit",
          enrichment: {
            complete: false,
            pendingSlugs: ["waiting"],
            failedSlugs: ["unavailable"],
          },
        },
      });
      expect(jobs.ensureJob).not.toHaveBeenCalled();
    }
  );

  it("refreshes only the stale list snapshot, not its page movies", async () => {
    const repository = fakeRepository();
    repository.getWatchlist = vi.fn().mockResolvedValue(
      list([movie("one", "resolved", stale), movie("two", "resolved", stale)], stale)
    );
    const jobs = fakeJobs();
    const response = await new ApiService(repository, jobs, () => now).getWatchlist(
      "alice",
      1,
      10
    );

    expect("meta" in response && response.meta).toMatchObject({
      cache: "stale",
      refreshJobs: [{ resourceKey: "watchlist:alice" }],
    });
    expect(jobs.ensureJob).toHaveBeenCalledTimes(1);
  });

  it("returns the lean movie DTO with a nullable TMDB id", async () => {
    const repository = fakeRepository();
    repository.getMovieByLetterboxdSlug = vi
      .fn()
      .mockResolvedValue(movie("no-tmdb", "resolved"));
    const response = await new ApiService(
      repository,
      fakeJobs(),
      () => now
    ).getMovieByLetterboxdSlug("no-tmdb");

    expect("data" in response && response.data).toEqual({
      letterboxdSlug: "no-tmdb",
      title: "No Tmdb",
      year: 2026,
      letterboxdFilmId: 42,
      tmdbId: null,
      letterboxdPoster: "https://a.ltrbxd.com/no-tmdb.jpg",
      letterboxdRating: 4.2,
    });
  });
});

function user(stamp = fresh): UserRecord {
  return {
    username: "alice",
    displayName: "Alice",
    avatarUrl: null,
    profile: fresh,
    watchlist: stamp,
    watched: stamp,
    network: fresh,
  };
}

function movie(
  slug: string,
  resolutionStatus: MovieRecord["resolutionStatus"],
  stamp: CacheStamp = fresh
): MovieRecord {
  return {
    letterboxdSlug: slug,
    letterboxdFilmId: 42,
    tmdbId: null,
    resolutionStatus,
    title: slug
      .split("-")
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join(" "),
    year: 2026,
    letterboxdPoster: `https://a.ltrbxd.com/${slug}.jpg`,
    letterboxdRating: 4.2,
    letterboxd: stamp,
  };
}

function list(movies: MovieRecord[], stamp = fresh): UserListRecord {
  return {
    user: user(stamp),
    items: movies.map((entry, position) => ({ position, movie: entry })),
  };
}

function fakeRepository(): ApiRepository {
  return {
    getUser: vi.fn().mockResolvedValue(null),
    getWatchlist: vi.fn().mockResolvedValue(null),
    getWatched: vi.fn().mockResolvedValue(null),
    getNetwork: vi.fn().mockResolvedValue(null),
    getMovieByTmdbId: vi.fn().mockResolvedValue(null),
    getMovieByLetterboxdSlug: vi.fn().mockResolvedValue(null),
    getWatchlists: vi.fn().mockResolvedValue([]),
  };
}

function fakeJobs(): JobGateway & { ensureJob: ReturnType<typeof vi.fn> } {
  let counter = 0;
  return {
    ensureJob: vi.fn(async (type: StoredJobRecord["type"], identifier: string) => {
      counter++;
      return job(type, identifier, counter);
    }),
    getJob: vi.fn().mockResolvedValue(null),
  };
}

function job(
  type: StoredJobRecord["type"],
  identifier: string,
  counter: number
): StoredJobRecord {
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    type,
    resourceKey: `${type}:${identifier}`,
    status: "queued",
    attempts: 0,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    errorCode: null,
  };
}
