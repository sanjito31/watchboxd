import { describe, expect, it, vi } from "vitest";
import {
  buildFilmGridPageUrl,
  scrapeFilmGrid,
} from "./scrapeFilmGrid";

function grid(...films: Array<{ slug: string; name: string; uid?: string }>) {
  return `<div>${films
    .map(
      ({ slug, name, uid }) => `<div
        data-item-link="/film/${slug}/"
        data-item-slug="${slug}"
        data-item-name="${name}"
        ${
          uid
            ? `data-resolvable-poster-path='{"postered":{"lid":"x","uid":"${uid}"},"cacheBustingKey":"key"}'`
            : ""
        }
      ></div>`
    )
    .join("")}</div>`;
}

describe("scrapeFilmGrid", () => {
  it("paginates watchlist and films routes with existing URL behavior", () => {
    expect(buildFilmGridPageUrl("alice", "watchlist", 1)).toBe(
      "https://letterboxd.com/alice/watchlist/"
    );
    expect(buildFilmGridPageUrl("alice", "films", 3)).toBe(
      "https://letterboxd.com/alice/films/page/3/"
    );
  });

  it("preserves first-seen order across watchlist pages", async () => {
    const fetchPage = vi
      .fn<(url: string) => Promise<string>>()
      .mockResolvedValueOnce(grid({ slug: "one", name: "One (2020)" }))
      .mockResolvedValueOnce(grid({ slug: "two", name: "Two (2021)" }))
      .mockResolvedValueOnce("<div></div>");
    const wait = vi.fn(async () => undefined);

    const items = await scrapeFilmGrid("Alice", "watchlist", {
      fetchPage,
      sleep: wait,
    });

    expect(items.map(({ sourceSlug, position }) => [sourceSlug, position])).toEqual(
      [
        ["one", 0],
        ["two", 1],
      ]
    );
    expect(fetchPage).toHaveBeenNthCalledWith(
      2,
      "https://letterboxd.com/alice/watchlist/page/2/"
    );
    expect(wait).toHaveBeenCalledWith(280);
  });

  it("deduplicates watched titles while preserving the first source record", async () => {
    const fetchPage = vi
      .fn<(url: string) => Promise<string>>()
      .mockResolvedValueOnce(
        grid(
          { slug: "the-match", name: "The Match (2020)" },
          { slug: "other", name: "Other (2021)", uid: "film:99" }
        )
      )
      .mockResolvedValueOnce(
        grid(
          { slug: "the-match-alt", name: "The Match (2020)" },
          { slug: "other-alt", name: "Other (2021)", uid: "film:99" }
        )
      )
      .mockResolvedValueOnce("<div></div>");

    const items = await scrapeFilmGrid("alice", "films", {
      fetchPage,
      sleep: async () => undefined,
    });

    expect(items.map((item) => item.sourceSlug)).toEqual([
      "the-match",
      "other",
    ]);
    expect(items.map((item) => item.position)).toEqual([0, 1]);
  });
});
