import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { scrapeLetterboxdMovie } from "./scrapeMovie";

const fixture = readFileSync(
  new URL("./__fixtures__/film-page.html", import.meta.url),
  "utf8"
);

describe("scrapeLetterboxdMovie", () => {
  it("returns only authoritative Letterboxd fields and follows canonical slugs", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      html: fixture,
      url: "https://letterboxd.com/film/interstellar/",
    });
    const result = await scrapeLetterboxdMovie(
      { letterboxdSlug: "interstellar-old" },
      { fetchPage, now: () => new Date("2026-08-20T12:00:00.000Z") }
    );

    expect(fetchPage).toHaveBeenCalledWith(
      "https://letterboxd.com/film/interstellar-old/"
    );
    expect(result).toMatchObject({
      requestedSlug: "interstellar-old",
      letterboxdSlug: "interstellar",
      title: "Interstellar",
      year: 2014,
      tmdbId: 157336,
      letterboxdPoster: expect.any(String),
    });
    expect(Object.keys(result)).not.toContain("overview");
  });

  it("resolves successfully when Letterboxd exposes no TMDB link", async () => {
    const result = await scrapeLetterboxdMovie(
      { letterboxdSlug: "independent-film" },
      {
        fetchPage: async () => ({
          url: "https://letterboxd.com/film/independent-film/",
          html: '<meta property="og:title" content="Independent Film (2026)">',
        }),
      }
    );
    expect(result.tmdbId).toBeNull();
    expect(result.title).toBe("Independent Film");
  });
});
