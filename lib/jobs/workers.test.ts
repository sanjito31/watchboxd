import { describe, expect, it, vi } from "vitest";
import { persistFilmGridSnapshot, persistMovieSnapshot } from "./workers";

const fetchedAt = new Date("2026-08-20T12:00:00.000Z");

describe("film-grid persistence", () => {
  it("persists lightweight relationships and durable child jobs atomically", async () => {
    const transaction = transactionMock();
    const jobs = await persistFilmGridSnapshot(
      transaction as never,
      snapshot(),
      "watchlist",
      { environment: "development" }
    );

    const query = transaction.$executeRaw.mock.calls[0]![0] as { values: unknown[] };
    const payload = query.values.find(
      (value): value is string => typeof value === "string" && value.startsWith("[")
    );
    expect(JSON.parse(payload!)).toEqual([
      {
        slug: "interstellar",
        title: "Interstellar",
        year: 2014,
        poster: "https://a.ltrbxd.com/poster.jpg",
      },
    ]);
    expect(transaction.watchlistItem.createMany).toHaveBeenCalledWith({
      data: [{ userId: BigInt(1), movieId: BigInt(10), position: 0 }],
    });
    expect(transaction.scrapeJob.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ resourceKey: "movie:interstellar" })],
        skipDuplicates: true,
      })
    );
    expect(jobs).toHaveLength(1);
  });

  it("resolves known aliases without creating another movie", async () => {
    const transaction = transactionMock();
    transaction.movieAlias.findMany.mockResolvedValue([
      {
        slug: "old-slug",
        movieId: BigInt(10),
        movie: {
          id: BigInt(10),
          letterboxdSlug: "canonical-slug",
          resolutionStatus: "RESOLVED",
        },
      },
    ]);
    const data = snapshot();
    data.items[0]!.sourceSlug = "old-slug";
    data.films = data.items;

    await persistFilmGridSnapshot(transaction as never, data, "watchlist", {
      environment: "development",
    });

    expect(transaction.$executeRaw).not.toHaveBeenCalled();
    expect(transaction.watchlistItem.createMany).toHaveBeenCalledWith({
      data: [{ userId: BigInt(1), movieId: BigInt(10), position: 0 }],
    });
    expect(transaction.scrapeJob.createMany).not.toHaveBeenCalled();
  });
});

describe("movie persistence", () => {
  it("acquires identity locks without deserializing PostgreSQL void values", async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi
        .fn()
        .mockRejectedValue(new Error("void results must not be queried")),
      movie: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: BigInt(10) }),
      },
    };

    await persistMovieSnapshot(transaction as never, {
      requestedSlug: "interstellar-old",
      letterboxdSlug: "interstellar",
      title: "Interstellar",
      year: 2014,
      letterboxdFilmId: 81371,
      tmdbId: 157336,
      letterboxdPoster: "https://a.ltrbxd.com/poster.jpg",
      letterboxdRating: 4.2,
      letterboxdFetchedAt: fetchedAt,
      letterboxdStaleAt: new Date("2026-08-27T12:00:00.000Z"),
    });

    expect(transaction.$executeRaw).toHaveBeenCalledTimes(3);
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
    expect(transaction.movie.create).toHaveBeenCalledOnce();
  });
});

function snapshot() {
  const item = {
    slug: "interstellar",
    title: "Interstellar",
    year: 2014,
    url: "https://letterboxd.com/film/interstellar/",
    position: 0,
    sourceTitle: "Interstellar",
    sourceSlug: "interstellar",
    sourceYear: 2014,
    letterboxdFilmId: 81371,
    letterboxdPosterUrls: ["https://a.ltrbxd.com/poster.jpg"],
  };
  return {
    username: "alice",
    items: [item],
    films: [item],
    filmCount: 1,
    fetchedAt,
  };
}

function transactionMock() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    letterboxdUser: { upsert: vi.fn().mockResolvedValue({ id: BigInt(1) }) },
    movieAlias: { findMany: vi.fn().mockResolvedValue([]) },
    movie: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: BigInt(10),
          letterboxdSlug: "interstellar",
          resolutionStatus: "PENDING",
        },
      ]),
    },
    watchlistItem: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    scrapeJob: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "00000000-0000-4000-8000-000000000001",
          environment: "DEVELOPMENT",
          type: "MOVIE",
          resourceKey: "movie:interstellar",
          status: "QUEUED",
          attempts: 0,
          queueMessageId: null,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
          createdAt: fetchedAt,
          updatedAt: fetchedAt,
        },
      ]),
    },
  };
}
