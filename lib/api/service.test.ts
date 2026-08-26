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
  WatchedListItemRecord,
  ListQuery,
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
          ? await service.getWatchlist("alice", query())
          : await service.getWatched("alice", query());

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
    const snapshot = list([
      movie("gone", "failed"),
      movie("resolved", "resolved"),
      movie("resolved-two", "resolved"),
    ]);
    repository.getWatchlist = vi.fn().mockResolvedValue({
      ...snapshot,
      items: snapshot.items.slice(0, 1),
      pagination: { page: 1, pageSize: 1, total: 3, totalPages: 3 },
    });
    const jobs = fakeJobs();
    const response = await new ApiService(repository, jobs, () => now).getWatchlist(
      "alice",
      query({ pageSize: 1 })
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
        metadata: null,
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
          ? await service.getWatchlist("alice", query())
          : await service.getWatched("alice", query());

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
      query()
    );

    expect("meta" in response && response.meta).toMatchObject({
      cache: "stale",
      refreshJobs: [{ resourceKey: "watchlist:alice" }],
    });
    expect(jobs.ensureJob).toHaveBeenCalledTimes(1);
  });

  it("returns the full movie DTO with metadata and genres", async () => {
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
      metadata: {
        runtimeMinutes: 120,
        overview: "Overview",
        tmdbTitle: "TMDB title",
        originalTitle: "Original title",
        originalLanguage: "en",
        tmdbReleaseDate: "2026-01-02",
        tmdbVoteAverage: 8.1,
        tmdbPosterPath: "/poster.jpg",
        tmdbBackdropPath: "/backdrop.jpg",
        tmdbFetchedAt: fresh.fetchedAt.toISOString(),
        tmdbStaleAt: fresh.staleAt.toISOString(),
        genres: [{ id: 18, name: "Drama" }],
      },
    });
  });

  it("queues missing TMDB metadata for an already resolved movie", async () => {
    const repository = fakeRepository();
    repository.getMovieByTmdbId = vi.fn().mockResolvedValue({
      ...movie("interstellar", "resolved"),
      tmdbId: 157336,
      metadata: null,
    });
    const jobs = fakeJobs();

    const response = await new ApiService(repository, jobs, () => now).getMovie(
      157336
    );

    expect("meta" in response && response.meta).toMatchObject({
      cache: "stale",
      refreshJobs: [{ resourceKey: "movie_metadata:tmdb_157336" }],
    });
    expect(jobs.ensureJob).toHaveBeenCalledWith(
      "movie_metadata",
      "tmdb_157336"
    );
  });

  it("returns the user's Letterboxd rating on watched items", async () => {
    const repository = fakeRepository();
    repository.getWatched = vi.fn().mockResolvedValue(
      watchedList([movie("rated", "resolved")], [4.5])
    );

    const response = await new ApiService(
      repository,
      fakeJobs(),
      () => now
    ).getWatched("alice", query());

    expect("data" in response && response.data?.items).toEqual([
      expect.objectContaining({ position: 0, userRating: 4.5 }),
    ]);
  });

  it("queues an explicit watched refresh without consulting cache freshness", async () => {
    const repository = fakeRepository();
    const jobs = fakeJobs();
    const response = await new ApiService(repository, jobs, () => now).requestJob(
      "watched",
      "alice"
    );

    expect(response).toMatchObject({
      data: null,
      meta: { jobs: [{ resourceKey: "watched:alice" }] },
    });
    expect(jobs.ensureJob).toHaveBeenCalledWith("watched", "alice");
    expect(repository.getWatched).not.toHaveBeenCalled();
  });

  it("returns the repository's paginated watchlist intersection without movie refresh fan-out", async () => {
    const repository = fakeRepository();
    const alice = user();
    const bob = { ...user(), username: "bob", displayName: "Bob" };
    repository.getUsers = vi.fn().mockResolvedValue([alice, bob]);
    repository.getWatchlistOverlap = vi.fn().mockResolvedValue({
      groups: [
        {
          movie: movie("shared", "pending"),
          presentFor: [
            { username: "alice", displayName: "Alice", avatarUrl: null },
            { username: "bob", displayName: "Bob", avatarUrl: null },
          ],
        },
      ],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
    const jobs = fakeJobs();

    const response = await new ApiService(repository, jobs, () => now).getOverlap(
      ["alice", "bob"],
      query()
    );

    expect(response).toMatchObject({
      data: {
        films: [{ letterboxdSlug: "shared", overlapCount: 2, partySize: 2 }],
        pagination: { total: 1 },
      },
      meta: { enrichment: { pendingSlugs: ["shared"] } },
    });
    expect(jobs.ensureJob).not.toHaveBeenCalled();
  });

  it("returns watched union attribution and each requested user's rating", async () => {
    const repository = fakeRepository();
    const alice = user();
    const bob = { ...user(), username: "bob", displayName: "Bob" };
    repository.getUsers = vi.fn().mockResolvedValue([alice, bob]);
    repository.getWatchedOverlap = vi.fn().mockResolvedValue({
      groups: [
        {
          movie: movie("shared-watch", "resolved"),
          watchedBy: [
            { username: "alice", displayName: "Alice", avatarUrl: null, userRating: 4.5 },
            { username: "bob", displayName: "Bob", avatarUrl: null, userRating: 3 },
          ],
        },
      ],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });

    const response = await new ApiService(
      repository,
      fakeJobs(),
      () => now
    ).getWatchedOverlap(["alice", "bob"], {
      ...query({ includeMetadata: true }),
      userRatingMin: 3,
      ratingMode: "any",
    });

    expect(response).toMatchObject({
      data: {
        films: [
          {
            letterboxdSlug: "shared-watch",
            watchedCount: 2,
            partySize: 2,
            watchedBy: [
              { username: "alice", userRating: 4.5 },
              { username: "bob", userRating: 3 },
            ],
            metadata: { genres: [{ id: 18, name: "Drama" }] },
          },
        ],
      },
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
    metadata: {
      ...fresh,
      runtimeMinutes: 120,
      overview: "Overview",
      tmdbTitle: "TMDB title",
      originalTitle: "Original title",
      originalLanguage: "en",
      tmdbReleaseDate: new Date("2026-01-02T00:00:00.000Z"),
      tmdbVoteAverage: 8.1,
      tmdbPosterPath: "/poster.jpg",
      tmdbBackdropPath: "/backdrop.jpg",
      genres: [{ id: 18, name: "Drama" }],
    },
  };
}

function list(movies: MovieRecord[], stamp = fresh): UserListRecord {
  return {
    user: user(stamp),
    items: movies.map((entry, position) => ({ position, movie: entry })),
    total: movies.length,
    pagination: { page: 1, pageSize: 10, total: movies.length, totalPages: 1 },
  };
}

function watchedList(
  movies: MovieRecord[],
  ratings: Array<number | null>,
  stamp = fresh
): UserListRecord<WatchedListItemRecord> {
  return {
    user: user(stamp),
    items: movies.map((entry, position) => ({
      position,
      movie: entry,
      userRating: ratings[position] ?? null,
    })),
    total: movies.length,
    pagination: { page: 1, pageSize: 10, total: movies.length, totalPages: 1 },
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
    getUsers: vi.fn().mockResolvedValue([]),
    getWatchlistOverlap: vi.fn().mockResolvedValue({
      groups: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
    }),
    getWatchedOverlap: vi.fn().mockResolvedValue({
      groups: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
    }),
  };
}

function query(overrides: Partial<ListQuery> = {}): ListQuery {
  return {
    page: 1,
    pageSize: 10,
    includeMetadata: false,
    filters: {
      genreIds: [],
      genreNames: [],
      genreMode: "any",
    },
    ...overrides,
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
