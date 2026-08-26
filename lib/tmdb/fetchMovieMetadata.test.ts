import { describe, expect, it, vi } from "vitest";
import { fetchTmdbMovieMetadata } from "./fetchMovieMetadata";

describe("fetchTmdbMovieMetadata", () => {
  it("normalizes TMDB movie details and genres", async () => {
    const fetchedAt = new Date("2026-08-24T12:00:00.000Z");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: 157336,
        runtime: 169,
        overview: "A team travels through a wormhole.",
        title: "Interstellar",
        original_title: "Interstellar",
        original_language: "en",
        release_date: "2014-11-05",
        vote_average: 8.5,
        poster_path: "/poster.jpg",
        backdrop_path: "/backdrop.jpg",
        genres: [
          { id: 12, name: "Adventure" },
          { id: 18, name: "Drama" },
        ],
      })
    );

    const result = await fetchTmdbMovieMetadata(157336, {
      accessToken: "test-token",
      fetcher,
      now: () => fetchedAt,
    });

    expect(result).toMatchObject({
      tmdbId: 157336,
      runtimeMinutes: 169,
      tmdbTitle: "Interstellar",
      tmdbReleaseDate: new Date("2014-11-05T00:00:00.000Z"),
      genres: [
        { id: 12, name: "Adventure" },
        { id: 18, name: "Drama" },
      ],
      tmdbFetchedAt: fetchedAt,
      tmdbStaleAt: new Date("2026-11-22T12:00:00.000Z"),
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.themoviedb.org/3/movie/157336?language=en-US",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      })
    );
  });

  it("classifies rate limiting without exposing the token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("", { status: 429, headers: { "Retry-After": "8" } })
    );
    await expect(
      fetchTmdbMovieMetadata(157336, { accessToken: "secret", fetcher })
    ).rejects.toMatchObject({
      kind: "rate_limited",
      status: 429,
      retryAfterSeconds: 8,
      message: "TMDB request failed with HTTP 429",
    });
  });

  it("rejects malformed successful payloads permanently", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ id: 157336, genres: "Adventure" })
    );
    await expect(
      fetchTmdbMovieMetadata(157336, { accessToken: "secret", fetcher })
    ).rejects.toMatchObject({ kind: "parse_error" });
  });
});
