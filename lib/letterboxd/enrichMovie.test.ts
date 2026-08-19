import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  TmdbMovieDetails,
  TmdbMovieProvider,
} from "@/lib/tmdb/types";
import { enrichMovie } from "./enrichMovie";

const filmHtml = readFileSync(
  join(__dirname, "__fixtures__", "film-page.html"),
  "utf8"
);
const details = JSON.parse(
  readFileSync(
    join(__dirname, "..", "tmdb", "__fixtures__", "movie-details.json"),
    "utf8"
  )
) as TmdbMovieDetails;

function tmdbProvider(movie: TmdbMovieDetails): TmdbMovieProvider {
  return {
    searchMovies: vi.fn(),
    getMovieDetails: vi.fn(async () => movie),
  };
}

describe("enrichMovie", () => {
  it("returns DTO metadata, source timestamps, and every poster fallback", async () => {
    const times = [
      new Date("2026-08-19T12:00:00.000Z"),
      new Date("2026-08-19T12:00:01.000Z"),
    ];
    const candidates = [
      "https://a.ltrbxd.com/grid-primary.jpg",
      "https://a.ltrbxd.com/grid-fallback.jpg",
    ];

    const result = await enrichMovie(
      {
        letterboxdSlug: "interstellar",
        sourceTitle: "Interstellar",
        sourceYear: 2014,
        directTmdbId: 157336,
        letterboxdPosterUrls: candidates,
      },
      {
        tmdb: tmdbProvider(details),
        fetchLetterboxdHtml: vi.fn(async () => filmHtml),
        now: () => times.shift()!,
      }
    );

    expect(result).toMatchObject({
      letterboxdFilmId: 81371,
      tmdbId: 157336,
      resolutionStatus: "resolved",
      title: "Interstellar",
      year: 2014,
      originalTitle: "Interstellar",
      runtimeMinutes: 169,
      letterboxdRating: 4.31,
      posterSource: "tmdb",
      tmdbPosterPath: details.poster_path,
      tmdbBackdropPath: details.backdrop_path,
    });
    expect(result.posterUrl).toContain(details.poster_path!);
    expect(result.letterboxdPosterUrls).toEqual([
      ...candidates,
      "https://a.ltrbxd.com/resized/interstellar-primary.jpg",
      "https://a.ltrbxd.com/resized/interstellar-fallback.jpg",
    ]);
    expect(result.posterFallbackUrls).toEqual([
      ...result.letterboxdPosterUrls,
      "/file.svg",
    ]);
    expect(result.letterboxdStaleAt.toISOString()).toBe(
      "2026-08-20T12:00:00.000Z"
    );
    expect(result.tmdbStaleAt?.toISOString()).toBe(
      "2026-09-18T12:00:01.000Z"
    );
  });

  it("uses the film page TMDB ID rather than the Letterboxd poster UID", async () => {
    const provider = tmdbProvider(details);
    const result = await enrichMovie(
      { letterboxdSlug: "interstellar" },
      {
        tmdb: provider,
        fetchLetterboxdHtml: async () => filmHtml,
      }
    );

    expect(result.letterboxdFilmId).toBe(81371);
    expect(result.tmdbId).toBe(157336);
    expect(provider.getMovieDetails).toHaveBeenCalledWith(157336);
    expect(provider.searchMovies).not.toHaveBeenCalled();
  });

  it("uses persisted Letterboxd candidates when TMDB has no poster", async () => {
    const result = await enrichMovie(
      {
        letterboxdSlug: "interstellar",
        sourceTitle: "Interstellar",
        sourceYear: 2014,
        tmdbId: 157336,
        letterboxdPosterUrls: ["https://a.ltrbxd.com/grid-primary.jpg"],
      },
      {
        tmdb: tmdbProvider({ ...details, poster_path: null }),
        fetchLetterboxdHtml: async () => filmHtml,
      }
    );

    expect(result.posterSource).toBe("letterboxd");
    expect(result.posterUrl).toBe(
      "https://a.ltrbxd.com/grid-primary.jpg"
    );
    expect(result.posterFallbackUrls.at(-1)).toBe("/file.svg");
  });

  it("caches a completed unresolved attempt when no release year exists", async () => {
    const times = [
      new Date("2026-08-19T12:00:00.000Z"),
      new Date("2026-08-19T12:00:01.000Z"),
    ];

    const result = await enrichMovie(
      { letterboxdSlug: "yearless-film" },
      {
        fetchLetterboxdHtml: async () =>
          '<script type="application/ld+json">{"name":"Yearless Film"}</script>',
        now: () => times.shift()!,
      }
    );

    expect(result.resolutionStatus).toBe("unresolved");
    expect(result.tmdbId).toBeNull();
    expect(result.tmdbFetchedAt?.toISOString()).toBe(
      "2026-08-19T12:00:01.000Z"
    );
    expect(result.tmdbStaleAt?.toISOString()).toBe(
      "2026-09-18T12:00:01.000Z"
    );
  });
});
