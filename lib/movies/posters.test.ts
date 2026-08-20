import { describe, expect, it } from "vitest";
import {
  DEFAULT_POSTER_PLACEHOLDER_URL,
  buildTmdbPosterUrl,
  selectPoster,
} from "./posters";

describe("poster contract", () => {
  it("uses TMDB first, then ordered unique Letterboxd candidates, then placeholder", () => {
    expect(
      selectPoster({
        tmdbPosterPath: "/tmdb.jpg",
        letterboxdPosterUrls: [
          "https://letterboxd.example/primary.jpg",
          "https://letterboxd.example/fallback.jpg",
          "https://letterboxd.example/primary.jpg",
        ],
      })
    ).toEqual({
      posterUrl: buildTmdbPosterUrl("/tmdb.jpg"),
      posterSource: "tmdb",
      posterFallbackUrls: [
        "https://letterboxd.example/primary.jpg",
        "https://letterboxd.example/fallback.jpg",
        DEFAULT_POSTER_PLACEHOLDER_URL,
      ],
    });
  });

  it("promotes the primary Letterboxd candidate when TMDB has no poster", () => {
    expect(
      selectPoster({
        letterboxdPosterUrls: [" https://letterboxd.example/primary.jpg "],
      })
    ).toEqual({
      posterUrl: "https://letterboxd.example/primary.jpg",
      posterSource: "letterboxd",
      posterFallbackUrls: [DEFAULT_POSTER_PLACEHOLDER_URL],
    });
  });

  it("returns the local placeholder when no remote candidate exists", () => {
    expect(selectPoster({})).toEqual({
      posterUrl: DEFAULT_POSTER_PLACEHOLDER_URL,
      posterSource: "placeholder",
      posterFallbackUrls: [],
    });
  });
});
