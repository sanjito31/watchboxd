import { describe, expect, it } from "vitest";
import { ApiService } from "@/lib/api/service";
import type {
  ApiRepository,
  JobGateway,
  MovieRecord,
  NetworkRecord,
  StoredJobRecord,
  UserListRecord,
  UserRecord,
} from "@/lib/api/types";
import type {
  CanonicalResourceKey,
  JobType,
} from "@/lib/jobs/contracts";

const NOW = new Date("2026-08-19T16:00:00.000Z");
const FRESH = {
  fetchedAt: new Date("2026-08-19T15:00:00.000Z"),
  staleAt: new Date("2026-08-20T15:00:00.000Z"),
};
const STALE = {
  fetchedAt: new Date("2026-08-18T15:00:00.000Z"),
  staleAt: new Date("2026-08-19T15:00:00.000Z"),
};
const MISSING = { fetchedAt: null, staleAt: null };

describe("ApiService", () => {
  it("returns fresh profile hits without creating jobs", async () => {
    const repository = new FakeRepository();
    repository.users.set("alice", makeUser("alice"));
    const jobs = new FakeJobs();

    const result = await service(repository, jobs).getProfile("alice");

    expect(result).toMatchObject({
      data: {
        username: "alice",
        letterboxdUrl: "https://letterboxd.com/alice/",
      },
      meta: { cache: "hit" },
    });
    expect(jobs.ensureCalls).toEqual([]);
  });

  it("returns a miss with one reusable active job", async () => {
    const repository = new FakeRepository();
    const jobs = new FakeJobs();
    const api = service(repository, jobs);

    const first = await api.getProfile("alice");
    const second = await api.getProfile("alice");

    expect(first).toMatchObject({
      data: null,
      meta: {
        cache: "miss",
        jobs: [{ type: "profile", resourceKey: "profile:alice" }],
      },
    });
    expect(second).toEqual(first);
    expect(jobs.activeJobs).toHaveLength(1);
  });

  it("serves stale data and attaches the refresh job", async () => {
    const repository = new FakeRepository();
    repository.users.set(
      "alice",
      makeUser("alice", { profile: STALE })
    );
    const jobs = new FakeJobs();

    const result = await service(repository, jobs).getProfile("alice");

    expect(result).toMatchObject({
      data: { username: "alice" },
      meta: {
        cache: "stale",
        refreshJob: {
          type: "profile",
          resourceKey: "profile:alice",
        },
      },
    });
  });

  it("honors recent negative not-found caching", async () => {
    const repository = new FakeRepository();
    const jobs = new FakeJobs();
    jobs.negativeKeys.add("movie:tmdb_999");

    const result = await service(repository, jobs).getMovie(999);

    expect(result).toEqual({
      error: {
        code: "resource_not_found",
        message: "The requested Letterboxd resource was not found",
      },
    });
    expect(jobs.ensureCalls).toEqual(["movie:tmdb_999"]);
    expect(jobs.activeJobs).toEqual([]);
  });

  it("returns a movie cached by TMDB ID without creating a job", async () => {
    const repository = new FakeRepository();
    repository.movies.set(157336, makeMovie("interstellar", { tmdbId: 157336 }));
    const jobs = new FakeJobs();

    const result = await service(repository, jobs).getMovie(157336);

    expect(result).toMatchObject({
      data: {
        tmdbId: 157336,
        letterboxdSlug: "interstellar",
        letterboxdRating: null,
      },
      meta: { cache: "hit" },
    });
    expect(jobs.ensureCalls).toEqual([]);
  });

  it("refreshes a stale TMDB movie with the TMDB job identifier", async () => {
    const repository = new FakeRepository();
    repository.movies.set(
      157336,
      makeMovie("interstellar", {
        tmdbId: 157336,
        letterboxd: STALE,
      })
    );
    const jobs = new FakeJobs();

    const result = await service(repository, jobs).getMovie(157336);

    expect(result).toMatchObject({
      data: { tmdbId: 157336 },
      meta: {
        cache: "stale",
        refreshJob: { resourceKey: "movie:tmdb_157336" },
      },
    });
    expect(jobs.ensureCalls).toEqual(["movie:tmdb_157336"]);
  });

  it("returns a movie cached by Letterboxd slug without creating a job", async () => {
    const repository = new FakeRepository();
    repository.moviesBySlug.set(
      "interstellar",
      makeMovie("interstellar", { tmdbId: 157336 })
    );
    const jobs = new FakeJobs();

    const result = await service(repository, jobs).getMovieByLetterboxdSlug(
      "interstellar"
    );

    expect(result).toMatchObject({
      data: {
        tmdbId: 157336,
        letterboxdSlug: "interstellar",
      },
      meta: { cache: "hit" },
    });
    expect(jobs.ensureCalls).toEqual([]);
  });

  it("queues the existing slug movie job on a fallback cache miss", async () => {
    const jobs = new FakeJobs();

    const result = await service(
      new FakeRepository(),
      jobs
    ).getMovieByLetterboxdSlug("interstellar");

    expect(result).toMatchObject({
      data: null,
      meta: {
        cache: "miss",
        jobs: [{ resourceKey: "movie:interstellar" }],
      },
    });
    expect(jobs.ensureCalls).toEqual(["movie:interstellar"]);
  });

  it("maps a persisted queue publication failure to a public 503 envelope", async () => {
    const jobs = new FakeJobs();
    jobs.failedKeys.set("profile:alice", "upstream_unavailable");

    const result = await service(new FakeRepository(), jobs).getProfile("alice");

    expect(result).toEqual({
      error: {
        code: "upstream_unavailable",
        message: "The upstream service is temporarily unavailable",
      },
    });
  });

  it("paginates watchlists while preserving zero-based positions", async () => {
    const repository = new FakeRepository();
    repository.watchlists.set(
      "alice",
      makeList("alice", [
        makeItem(0, makeMovie("alpha", { title: "Alpha" })),
        makeItem(1, makeMovie("beta", { title: "Beta" })),
        makeItem(2, makeMovie("gamma", { title: "Gamma" })),
      ])
    );

    const result = await service(repository, new FakeJobs()).getWatchlist(
      "alice",
      2,
      2
    );

    expect(result).toMatchObject({
      data: {
        filmCount: 3,
        items: [{ position: 2, sourceSlug: "gamma" }],
        pagination: {
          page: 2,
          pageSize: 2,
          total: 3,
          totalPages: 2,
        },
      },
    });
  });

  it("queues the source profile with a missing network", async () => {
    const repository = new FakeRepository();
    repository.networks.set(
      "alice",
      makeNetwork("alice", { profile: MISSING, network: MISSING })
    );
    const jobs = new FakeJobs();

    const result = await service(repository, jobs).getNetwork("alice");

    expect(result).toMatchObject({
      data: null,
      meta: {
        cache: "miss",
        jobs: [
          { resourceKey: "profile:alice" },
          { resourceKey: "network:alice" },
        ],
      },
    });
    expect(jobs.ensureCalls).toEqual(["profile:alice", "network:alice"]);
  });

  it("queues only the source profile when the network is already cached", async () => {
    const repository = new FakeRepository();
    repository.networks.set(
      "alice",
      makeNetwork("alice", { profile: MISSING })
    );
    const jobs = new FakeJobs();

    const result = await service(repository, jobs).getNetwork("alice");

    expect(result).toMatchObject({
      data: null,
      meta: {
        jobs: [{ resourceKey: "profile:alice" }],
      },
    });
    expect(jobs.ensureCalls).toEqual(["profile:alice"]);
  });

  it("returns the source user with a cached network", async () => {
    const repository = new FakeRepository();
    repository.networks.set("alice", makeNetwork("alice"));
    const jobs = new FakeJobs();

    const result = await service(repository, jobs).getNetwork("alice");

    expect(result).toMatchObject({
      data: {
        username: "alice",
        user: {
          username: "alice",
          displayName: "ALICE",
          avatarUrl: "https://example.com/alice.jpg",
        },
      },
      meta: { cache: "hit" },
    });
    expect(jobs.ensureCalls).toEqual([]);
  });

  it("returns watchlist jobs when overlap inputs are missing", async () => {
    const repository = new FakeRepository();
    repository.watchlists.set("alice", makeList("alice", []));
    const jobs = new FakeJobs();

    const result = await service(repository, jobs).getOverlap(
      ["alice", "bob", "carol"],
      1,
      10
    );

    expect(result).toMatchObject({
      data: null,
      meta: {
        cache: "miss",
        jobs: [
          { resourceKey: "watchlist:bob" },
          { resourceKey: "watchlist:carol" },
        ],
      },
    });
  });

  it("groups overlap by TMDB ID then slug and sorts count/title", async () => {
    const repository = new FakeRepository();
    const sharedTmdbA = makeMovie("alternate-alpha", {
      tmdbId: 10,
      title: "Alpha",
    });
    const sharedTmdbB = makeMovie("alpha", { tmdbId: 10, title: "Alpha" });
    const slugOnly = makeMovie("beta", { title: "Beta" });
    const allThree = makeMovie("zulu", { tmdbId: 30, title: "Zulu" });
    repository.watchlists.set(
      "alice",
      makeList("alice", [
        makeItem(0, sharedTmdbA),
        makeItem(1, slugOnly),
        makeItem(2, allThree),
      ])
    );
    repository.watchlists.set(
      "bob",
      makeList("bob", [
        makeItem(0, sharedTmdbB),
        makeItem(1, slugOnly),
        makeItem(2, allThree),
      ])
    );
    repository.watchlists.set(
      "carol",
      makeList("carol", [makeItem(0, allThree)])
    );

    const result = await service(repository, new FakeJobs()).getOverlap(
      ["alice", "bob", "carol"],
      1,
      10
    );

    expect("data" in result && result.data).toMatchObject({
      films: [
        { title: "Zulu", overlapCount: 3, partySize: 3 },
        { title: "Alpha", overlapCount: 2, partySize: 3 },
        { title: "Beta", overlapCount: 2, partySize: 3 },
      ],
    });
  });

  it("returns pollable enrichment jobs only for uncached movies on the overlap page", async () => {
    const repository = new FakeRepository();
    const uncachedAlpha = makeMovie("alpha", {
      title: "Alpha",
      tmdb: MISSING,
      letterboxd: MISSING,
    });
    const uncachedBeta = makeMovie("beta", {
      title: "Beta",
      tmdb: MISSING,
      letterboxd: MISSING,
    });
    for (const username of ["alice", "bob"]) {
      repository.watchlists.set(
        username,
        makeList(username, [
          makeItem(0, uncachedAlpha),
          makeItem(1, uncachedBeta),
        ])
      );
    }
    const jobs = new FakeJobs();

    const result = await service(repository, jobs).getOverlap(
      ["alice", "bob"],
      1,
      1
    );

    expect(result).toMatchObject({
      data: null,
      meta: {
        cache: "miss",
        jobs: [{ resourceKey: "movie:alpha" }],
      },
    });
    expect(jobs.ensureCalls).toEqual(["movie:alpha"]);
  });

  it("sanitizes stored job errors for polling", async () => {
    const jobs = new FakeJobs();
    const job = jobs.makeJob("movie", "secret-film");
    job.status = "failed";
    job.errorCode = "upstream_unavailable";
    jobs.byId.set(job.id, job);

    const result = await service(new FakeRepository(), jobs).getJob(job.id);

    expect(result).toMatchObject({
      data: {
        status: "failed",
        error: {
          code: "upstream_unavailable",
          message: "The upstream service was unavailable",
        },
      },
    });
  });
});

function service(repository: ApiRepository, jobs: JobGateway) {
  return new ApiService(repository, jobs, () => NOW);
}

class FakeRepository implements ApiRepository {
  users = new Map<string, UserRecord>();
  watchlists = new Map<string, UserListRecord>();
  watched = new Map<string, UserListRecord>();
  networks = new Map<string, NetworkRecord>();
  movies = new Map<number, MovieRecord>();
  moviesBySlug = new Map<string, MovieRecord>();

  async getUser(username: string) {
    return this.users.get(username) ?? null;
  }

  async getWatchlist(username: string) {
    return this.watchlists.get(username) ?? null;
  }

  async getWatched(username: string) {
    return this.watched.get(username) ?? null;
  }

  async getNetwork(username: string) {
    return this.networks.get(username) ?? null;
  }

  async getMovieByTmdbId(tmdbId: number) {
    return this.movies.get(tmdbId) ?? null;
  }

  async getMovieByLetterboxdSlug(slug: string) {
    return this.moviesBySlug.get(slug) ?? null;
  }

  async getWatchlists(usernames: readonly string[]) {
    return usernames.flatMap((username) => {
      const value = this.watchlists.get(username);
      return value ? [value] : [];
    });
  }
}

class FakeJobs implements JobGateway {
  ensureCalls: string[] = [];
  activeJobs: StoredJobRecord[] = [];
  byId = new Map<string, StoredJobRecord>();
  negativeKeys = new Set<string>();
  failedKeys = new Map<
    string,
    NonNullable<StoredJobRecord["errorCode"]>
  >();

  async ensureJob(type: JobType, identifier: string) {
    const resourceKey = `${type}:${identifier}` as CanonicalResourceKey;
    this.ensureCalls.push(resourceKey);
    if (this.negativeKeys.has(resourceKey)) {
      return {
        ...this.makeJob(type, identifier),
        status: "failed" as const,
        finishedAt: NOW,
        errorCode: "not_found" as const,
      };
    }
    const failureCode = this.failedKeys.get(resourceKey);
    if (failureCode) {
      return {
        ...this.makeJob(type, identifier),
        status: "failed" as const,
        finishedAt: NOW,
        errorCode: failureCode,
      };
    }
    const existing = this.activeJobs.find(
      (job) => job.resourceKey === resourceKey
    );
    if (existing) return existing;

    const job = this.makeJob(type, identifier);
    this.activeJobs.push(job);
    this.byId.set(job.id, job);
    return job;
  }

  async getJob(id: string) {
    return this.byId.get(id) ?? null;
  }

  makeJob(type: JobType, identifier: string): StoredJobRecord {
    const sequence = this.byId.size + this.activeJobs.length + 1;
    return {
      id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      type,
      resourceKey: `${type}:${identifier}`,
      status: "queued",
      attempts: 0,
      createdAt: NOW,
      startedAt: null,
      finishedAt: null,
      errorCode: null,
    };
  }
}

function makeUser(
  username: string,
  overrides: Partial<UserRecord> = {}
): UserRecord {
  return {
    username,
    displayName: username.toUpperCase(),
    avatarUrl: `https://example.com/${username}.jpg`,
    profile: FRESH,
    watchlist: FRESH,
    watched: FRESH,
    network: FRESH,
    ...overrides,
  };
}

function makeList(
  username: string,
  items: UserListRecord["items"],
  userOverrides: Partial<UserRecord> = {}
): UserListRecord {
  return {
    user: makeUser(username, userOverrides),
    items,
  };
}

function makeNetwork(
  username: string,
  userOverrides: Partial<UserRecord> = {}
): NetworkRecord {
  const user = makeUser(username, userOverrides);
  return {
    user,
    data: {
      username,
      user: {
        username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      mutuals: [],
      following: [],
      truncated: false,
    },
  };
}

function makeItem(position: number, movie: MovieRecord) {
  return {
    position,
    sourceTitle: movie.title,
    sourceSlug: movie.letterboxdSlug,
    sourceYear: movie.year,
    resolutionStatus: movie.resolutionStatus,
    movie,
  };
}

function makeMovie(
  letterboxdSlug: string,
  overrides: Partial<MovieRecord> = {}
): MovieRecord {
  return {
    letterboxdSlug,
    letterboxdFilmId: null,
    tmdbId: null,
    resolutionStatus: "resolved",
    title: letterboxdSlug,
    year: 2026,
    tmdbTitle: null,
    tmdbOriginalTitle: null,
    tmdbOverview: null,
    tmdbReleaseDate: null,
    tmdbRuntimeMinutes: null,
    tmdbGenres: [],
    tmdbVoteAverage: null,
    tmdbPosterPath: null,
    tmdbBackdropPath: null,
    letterboxdPosterUrls: [],
    letterboxdRating: null,
    tmdb: FRESH,
    letterboxd: FRESH,
    ...overrides,
  };
}
