import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRssFeed } from "./parseRssFeed";

const fixture = readFileSync(
  join(__dirname, "__fixtures__", "rss-feed.xml"),
  "utf8"
);

describe("parseRssFeed", () => {
  it("extracts diary films newest first, skipping lists and repeat entries", () => {
    const films = parseRssFeed(fixture);

    expect(
      films.map(({ position, sourceSlug, sourceTitle, sourceYear, userRating }) => ({
        position,
        sourceSlug,
        sourceTitle,
        sourceYear,
        userRating,
      }))
    ).toEqual([
      {
        position: 0,
        sourceSlug: "heat-1995",
        sourceTitle: "Heat",
        sourceYear: 1995,
        userRating: 4.5,
      },
      {
        position: 1,
        sourceSlug: "clayface",
        sourceTitle: "Clayface",
        sourceYear: 2026,
        userRating: null,
      },
    ]);
  });

  it("uses the diary poster and the canonical film URL", () => {
    const [heat] = parseRssFeed(fixture);

    expect(heat).toMatchObject({
      url: "https://letterboxd.com/film/heat-1995/",
      posterUrl:
        "https://a.ltrbxd.com/resized/film-poster/heat-0-600-0-900-crop.jpg",
      letterboxdPosterUrls: [
        "https://a.ltrbxd.com/resized/film-poster/heat-0-600-0-900-crop.jpg",
      ],
    });
  });
});
