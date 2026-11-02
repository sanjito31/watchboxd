import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHtml: vi.fn<(url: string) => Promise<string>>(),
}));

vi.mock("./fetchHtml", () => ({
  fetchHtml: mocks.fetchHtml,
}));

import { ProviderBlockedError } from "./providerErrors";
import { scrapeUserWatched } from "./scrapeWatched";

const rss = readFileSync(join(__dirname, "__fixtures__", "rss-feed.xml"), "utf8");

const filmsRoot = `
  <li class="poster-container">
    <div data-item-link="/film/clayface/" data-item-slug="clayface"
      data-item-name="Clayface (2026)"
      data-resolvable-poster-path='{"postered":{"lid":"x","uid":"film:42"},"cacheBustingKey":"k"}'></div>
    <p class="poster-viewingdata">★★★</p>
  </li>
  <li class="poster-container">
    <div data-item-link="/film/older/" data-item-slug="older" data-item-name="Older (1990)"></div>
  </li>
  <div class="pagination"><a class="next" href="/alice/films/page/2/">Older</a></div>
`;

describe("scrapeUserWatched", () => {
  beforeEach(() => {
    mocks.fetchHtml.mockReset();
    mocks.fetchHtml.mockImplementation(async (url) => {
      if (url.endsWith("/alice/films/")) return filmsRoot;
      if (url.endsWith("/alice/rss/")) return rss;
      throw new ProviderBlockedError(`challenged ${url}`, { status: 403 });
    });
  });

  it("merges recent diary entries ahead of the first grid page when pagination is challenged", async () => {
    const result = await scrapeUserWatched("Alice");

    expect(result.complete).toBe(false);
    expect(
      result.items.map(({ position, sourceSlug, letterboxdFilmId, userRating }) => [
        position,
        sourceSlug,
        letterboxdFilmId,
        userRating,
      ])
    ).toEqual([
      [0, "heat-1995", null, 4.5],
      [1, "clayface", 42, 3],
      [2, "older", null, null],
    ]);
    expect(
      mocks.fetchHtml.mock.calls.filter(([url]) => url.includes("/films/page/"))
    ).toHaveLength(1);
  });

  it("returns the first grid page alone when the feed is unavailable", async () => {
    mocks.fetchHtml.mockImplementation(async (url) => {
      if (url.endsWith("/alice/films/")) return filmsRoot;
      throw new ProviderBlockedError(`challenged ${url}`, { status: 403 });
    });

    const result = await scrapeUserWatched("alice");

    expect(result.complete).toBe(false);
    expect(result.items.map(({ sourceSlug }) => sourceSlug)).toEqual([
      "clayface",
      "older",
    ]);
  });
});
