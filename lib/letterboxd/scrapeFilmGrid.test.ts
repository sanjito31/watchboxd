import { describe, expect, it, vi } from "vitest";
import {
  buildFilmGridPageUrl,
  scrapeFilmGrid,
} from "./scrapeFilmGrid";

function grid(
  ...films: Array<{ slug: string; name: string; uid?: string; rating?: string }>
) {
  return `<div>${films
    .map(
      ({ slug, name, uid, rating }) => `<li class="poster-container">
        <div
          data-item-link="/film/${slug}/"
          data-item-slug="${slug}"
          data-item-name="${name}"
          ${
            uid
              ? `data-resolvable-poster-path='{"postered":{"lid":"x","uid":"${uid}"},"cacheBustingKey":"key"}'`
              : ""
          }
        ></div>
        ${rating ? `<p class="poster-viewingdata">${rating}</p>` : ""}
      </li>`
    )
    .join("")}</div>`;
}

function withNextPage(html: string, href: string): string {
  return `${html}<div class="pagination"><a class="next" href="${href}">Older</a></div>`;
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
      .mockResolvedValueOnce(
        withNextPage(
          grid({ slug: "one", name: "One (2020)" }),
          "/alice/watchlist/page/2/"
        )
      )
      .mockResolvedValueOnce(grid({ slug: "two", name: "Two (2021)" }));
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
        withNextPage(
          grid(
            { slug: "the-match", name: "The Match (2020)", rating: "★★★½" },
            { slug: "other", name: "Other (2021)", uid: "film:99", rating: "★★★★" }
          ),
          "/alice/films/page/2/"
        )
      )
      .mockResolvedValueOnce(
        grid(
          { slug: "the-match-alt", name: "The Match (2020)" },
          { slug: "other-alt", name: "Other (2021)", uid: "film:99" }
        )
      );

    const items = await scrapeFilmGrid("alice", "films", {
      fetchPage,
      sleep: async () => undefined,
    });

    expect(items.map((item) => item.sourceSlug)).toEqual([
      "the-match",
      "other",
    ]);
    expect(items.map((item) => item.position)).toEqual([0, 1]);
    expect(items.map((item) => item.userRating)).toEqual([3.5, 4]);
  });

  it("scrapes beyond a full 72-film watched page when pagination continues", async () => {
    const firstPage = Array.from({ length: 72 }, (_, index) => ({
      slug: `film-${index}`,
      name: `Film ${index} (2020)`,
    }));
    const fetchPage = vi
      .fn<(url: string) => Promise<string>>()
      .mockResolvedValueOnce(
        withNextPage(grid(...firstPage), "/alice/films/page/2/")
      )
      .mockResolvedValueOnce(
        grid({ slug: "film-72", name: "Film 72 (2021)" })
      );

    const items = await scrapeFilmGrid("alice", "films", {
      fetchPage,
      sleep: async () => undefined,
    });

    expect(items).toHaveLength(73);
    expect(fetchPage).toHaveBeenNthCalledWith(
      2,
      "https://letterboxd.com/alice/films/page/2/"
    );
  });

  it("propagates a later-page failure instead of returning a partial snapshot", async () => {
    const failure = new Error("page 2 failed");
    const fetchPage = vi
      .fn<(url: string) => Promise<string>>()
      .mockResolvedValueOnce(
        withNextPage(
          grid({ slug: "one", name: "One (2020)" }),
          "/alice/films/page/2/"
        )
      )
      .mockRejectedValueOnce(failure);

    await expect(
      scrapeFilmGrid("alice", "films", {
        fetchPage,
        sleep: async () => undefined,
      })
    ).rejects.toBe(failure);
  });

  it("rejects an unexpectedly empty later page instead of truncating", async () => {
    const fetchPage = vi
      .fn<(url: string) => Promise<string>>()
      .mockResolvedValueOnce(
        withNextPage(
          grid({ slug: "one", name: "One (2020)" }),
          "/alice/films/page/2/"
        )
      )
      .mockResolvedValueOnce("<html><body></body></html>");

    await expect(
      scrapeFilmGrid("alice", "films", {
        fetchPage,
        sleep: async () => undefined,
      })
    ).rejects.toThrow("Film grid page 2 contained no films");
  });

  it("fails instead of truncating when the pagination safety limit is reached", async () => {
    const fetchPage = vi.fn().mockResolvedValue(
      withNextPage(
        grid({ slug: "one", name: "One (2020)" }),
        "/alice/films/page/2/"
      )
    );

    await expect(
      scrapeFilmGrid("alice", "films", {
        fetchPage,
        maxPages: 1,
        sleep: async () => undefined,
      })
    ).rejects.toThrow("Film grid exceeded the 1-page safety limit");
  });
});
