import { describe, expect, it, vi } from "vitest";
import type { MovieEnrichmentResult, ScrapeResult } from "@/lib/letterboxd";
import {
  createDefaultWorkerRegistry,
  enrichFilmGridSnapshot,
  type EnrichedFilmGridSnapshot,
} from "./workers";

const fetchedAt = new Date("2026-08-19T12:00:00.000Z");
const enrichedMovie: MovieEnrichmentResult = {
  letterboxdFilmId: 81371,
  tmdbId: 157336,
  letterboxdSlug: "interstellar",
  letterboxdUrl: "https://letterboxd.com/film/interstellar/",
  title: "Interstellar",
  year: 2014,
  resolutionStatus: "resolved",
  letterboxdRating: 4.31,
  posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
  posterSource: "tmdb",
  posterFallbackUrls: ["https://a.ltrbxd.com/poster.jpg", "/file.svg"],
  originalTitle: "Interstellar",
  overview: "Explorers travel through a wormhole.",
  releaseDate: "2014-11-05",
  runtimeMinutes: 169,
  genres: ["Adventure", "Drama"],
  tmdbVoteAverage: 8.4,
  backdropUrl: "https://image.tmdb.org/t/p/w780/backdrop.jpg",
  tmdbTitle: "Interstellar",
  tmdbPosterPath: "/poster.jpg",
  tmdbBackdropPath: "/backdrop.jpg",
  letterboxdPosterUrls: ["https://a.ltrbxd.com/poster.jpg"],
  tmdbFetchedAt: fetchedAt,
  tmdbStaleAt: new Date("2026-09-18T12:00:00.000Z"),
  letterboxdFetchedAt: fetchedAt,
  letterboxdStaleAt: new Date("2026-08-20T12:00:00.000Z"),
  sourceTimestamps: {
    tmdb: {
      fetchedAt,
      staleAt: new Date("2026-09-18T12:00:00.000Z"),
    },
    letterboxd: {
      fetchedAt,
      staleAt: new Date("2026-08-20T12:00:00.000Z"),
    },
  },
};

describe("default snapshot workers", () => {
  it("persists eager TMDB enrichment with the watchlist relation", async () => {
    const events: string[] = [];
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      letterboxdUser: {
        upsert: vi.fn().mockResolvedValue({ id: BigInt(1) }),
      },
      movie: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: BigInt(10),
            letterboxdSlug: "interstellar",
            resolutionStatus: "RESOLVED",
          },
        ]),
      },
      watchlistItem: {
        deleteMany: vi.fn(async () => {
          events.push("delete");
          return { count: 1 };
        }),
        createMany: vi.fn(async () => {
          events.push("create");
          return { count: 1 };
        }),
      },
    };
    const snapshot: EnrichedFilmGridSnapshot = {
      ...gridSnapshot(),
      enrichedMovies: [enrichedMovie],
    };

    await createDefaultWorkerRegistry().watchlist.persist(
      transaction as never,
      snapshot,
      {
        identifier: "alice",
        fetchedAt: snapshot.fetchedAt,
      }
    );

    expect(events).toEqual(["delete", "create"]);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    const query = transaction.$executeRaw.mock.calls[0]![0] as {
      values: unknown[];
    };
    const payload = query.values.find(
      (value): value is string =>
        typeof value === "string" && value.startsWith("[")
    );
    expect(JSON.parse(payload!)[0]).toMatchObject({
      slug: "interstellar",
      tmdbId: 157336,
      resolutionStatus: "resolved",
      tmdbTitle: "Interstellar",
      letterboxdRating: 4.31,
    });
    expect(transaction.movie.findMany).toHaveBeenCalledWith({
      where: { letterboxdSlug: { in: ["interstellar"] } },
      select: { id: true, letterboxdSlug: true, resolutionStatus: true },
    });
    expect(transaction.watchlistItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: BigInt(1),
          movieId: BigInt(10),
          position: 0,
          resolutionStatus: "RESOLVED",
        }),
      ],
    });
  });

  it("enriches a new grid movie before it can be persisted", async () => {
    const enrich = vi.fn().mockResolvedValue(enrichedMovie);

    const result = await enrichFilmGridSnapshot(gridSnapshot(), {
      findExistingMovies: async () => [],
      enrich,
    });

    expect(enrich).toHaveBeenCalledWith(
      expect.objectContaining({
        letterboxdSlug: "interstellar",
        letterboxdFilmId: 81371,
        sourceTitle: "Interstellar",
        sourceYear: 2014,
      })
    );
    expect(result.enrichedMovies).toEqual([enrichedMovie]);
  });

  it("leaves refreshes for a completed movie to its own cache policy", async () => {
    const enrich = vi.fn();

    const result = await enrichFilmGridSnapshot(gridSnapshot(), {
      findExistingMovies: async () => [
        {
          letterboxdSlug: "interstellar",
          letterboxdFilmId: 81371,
          tmdbId: 157336,
          resolutionStatus: "RESOLVED",
          letterboxdPosterUrls: [],
          letterboxdStaleAt: new Date("2026-08-18T12:00:00.000Z"),
          tmdbStaleAt: new Date("2026-08-18T12:00:00.000Z"),
        },
      ],
      enrich,
    });

    expect(enrich).not.toHaveBeenCalled();
    expect(result.enrichedMovies).toEqual([]);
  });
});

function gridSnapshot(): ScrapeResult {
  const item = {
    slug: "interstellar",
    title: "Interstellar",
    year: 2014,
    url: "https://letterboxd.com/film/interstellar/",
    position: 0,
    sourceTitle: "Interstellar",
    sourceSlug: "interstellar",
    sourceYear: 2014,
    resolutionStatus: "pending" as const,
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
