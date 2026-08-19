import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeMovieTitle,
  resolveMovieByTitleAndYear,
} from "./resolveMovie";
import type {
  TmdbMovieProvider,
  TmdbSearchResponse,
} from "./types";

const ambiguous = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "ambiguous-search.json"), "utf8")
) as TmdbSearchResponse;

function provider(results: TmdbSearchResponse["results"]): TmdbMovieProvider {
  return {
    searchMovies: vi.fn(async () => ({
      page: 1,
      results,
      total_pages: 1,
      total_results: results.length,
    })),
    getMovieDetails: vi.fn(),
  };
}

describe("resolveMovieByTitleAndYear", () => {
  it("accepts one unique exact normalized title and year match", async () => {
    const match = {
      id: 10,
      title: "Amélie!",
      original_title: "Le Fabuleux Destin d'Amélie Poulain",
      release_date: "2001-04-25",
      poster_path: "/amelie.jpg",
      backdrop_path: null,
      vote_average: 8.0,
    };

    await expect(
      resolveMovieByTitleAndYear(provider([match]), "Amelie", 2001)
    ).resolves.toEqual({
      status: "resolved",
      tmdbId: 10,
      match,
    });
    expect(normalizeMovieTitle("  WALL·E  ")).toBe("wall e");
  });

  it("leaves multiple unique exact matches ambiguous", async () => {
    await expect(
      resolveMovieByTitleAndYear(provider(ambiguous.results), "The Match", 2020)
    ).resolves.toEqual({
      status: "ambiguous",
      tmdbId: null,
      match: null,
    });
  });

  it("leaves wrong-year and no-match results unresolved", async () => {
    await expect(
      resolveMovieByTitleAndYear(
        provider(ambiguous.results),
        "The Match",
        2021
      )
    ).resolves.toEqual({
      status: "unresolved",
      tmdbId: null,
      match: null,
    });
  });
});
