import { describe, expect, it } from "vitest";
import {
  buildTmdbMovieJobIdentifier,
  parseMovieJobIdentifier,
} from "./jobIdentifier";

describe("movie job identifiers", () => {
  it("round-trips a TMDB ID through its namespaced identifier", () => {
    const identifier = buildTmdbMovieJobIdentifier(157336);

    expect(identifier).toBe("tmdb_157336");
    expect(parseMovieJobIdentifier(identifier)).toEqual({
      kind: "tmdb",
      tmdbId: 157336,
    });
  });

  it("keeps existing Letterboxd slug identifiers compatible", () => {
    expect(parseMovieJobIdentifier("interstellar")).toEqual({
      kind: "letterboxd",
      letterboxdSlug: "interstellar",
    });
  });

  it("rejects malformed TMDB identifiers", () => {
    expect(() => parseMovieJobIdentifier("tmdb_0")).toThrow(TypeError);
    expect(() => parseMovieJobIdentifier("tmdb_nope")).toThrow(TypeError);
    expect(() => buildTmdbMovieJobIdentifier(2_147_483_648)).toThrow(TypeError);
  });
});
