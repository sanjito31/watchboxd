import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseLetterboxdFilmPage,
  parseLetterboxdWeightedAverage,
} from "./parseFilmPage";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "__fixtures__", name), "utf8");

describe("parseLetterboxdFilmPage", () => {
  it("extracts weighted average and ordered poster data from JSON-LD", () => {
    expect(parseLetterboxdFilmPage(fixture("film-page.html"))).toEqual({
      title: "Interstellar",
      year: 2014,
      letterboxdFilmId: 81371,
      tmdbId: 157336,
      weightedAverage: 4.31,
      posterUrls: [
        "https://a.ltrbxd.com/resized/interstellar-primary.jpg",
        "https://a.ltrbxd.com/resized/interstellar-fallback.jpg",
      ],
    });
  });

  it("ignores malformed and invalid JSON-LD values", () => {
    expect(
      parseLetterboxdWeightedAverage(fixture("film-page-malformed.html"))
    ).toBeNull();
    expect(parseLetterboxdWeightedAverage("<html></html>")).toBeNull();
  });

  it("uses current body and Open Graph identity when JSON-LD omits the year", () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Fight Club (1999)">
          <script type="application/ld+json">
            /* <![CDATA[ */
            {"name":"Fight Club","aggregateRating":{"ratingValue":4.27}}
            /* ]]> */
          </script>
        </head>
        <body data-tmdb-id="550">
          <div data-resolvable-poster-path='{"postered":{"uid":"film:51568"}}'></div>
        </body>
      </html>`;

    expect(parseLetterboxdFilmPage(html)).toMatchObject({
      title: "Fight Club",
      year: 1999,
      letterboxdFilmId: 51568,
      tmdbId: 550,
      weightedAverage: 4.27,
    });
  });

  it("prefers the outbound TMDB movie link over the body attribute", () => {
    const html = `
      <body data-tmdb-id="999">
        <a href="https://www.themoviedb.org/movie/550-fight-club">TMDB</a>
        <a href="https://example.com/movie/123">Unrelated</a>
      </body>`;

    expect(parseLetterboxdFilmPage(html).tmdbId).toBe(550);
  });

  it("ignores non-movie TMDB links and falls back to the body mapping", () => {
    const html = `
      <body data-tmdb-id="157336">
        <a href="https://www.themoviedb.org/tv/1399-game-of-thrones">TMDB</a>
      </body>`;

    expect(parseLetterboxdFilmPage(html).tmdbId).toBe(157336);
  });
});
