import { describe, expect, it, vi } from "vitest";
import { resolveLetterboxdMovieByTmdbId } from "./resolveTmdbMovie";

describe("resolveLetterboxdMovieByTmdbId", () => {
  it("extracts the slug from Letterboxd's TMDB redirect", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      html: "<html></html>",
      url: "https://letterboxd.com/film/interstellar/",
    });

    await expect(
      resolveLetterboxdMovieByTmdbId(157336, fetchPage)
    ).resolves.toEqual({
      letterboxdSlug: "interstellar",
      html: "<html></html>",
    });
    expect(fetchPage).toHaveBeenCalledWith(
      "https://letterboxd.com/tmdb/157336/"
    );
  });

  it("uses the canonical film URL when the response URL is unchanged", async () => {
    const html = `
      <html><head>
        <link rel="canonical" href="https://letterboxd.com/film/fight-club/">
      </head></html>
    `;

    await expect(
      resolveLetterboxdMovieByTmdbId(550, async () => ({
        html,
        url: "https://letterboxd.com/tmdb/550/",
      }))
    ).resolves.toMatchObject({ letterboxdSlug: "fight-club" });
  });

  it("returns a provider not-found error when no mapping is present", async () => {
    await expect(
      resolveLetterboxdMovieByTmdbId(999, async () => ({
        html: "<html></html>",
        url: "https://letterboxd.com/tmdb/999/",
      }))
    ).rejects.toMatchObject({ kind: "not_found", status: 404 });
  });
});
