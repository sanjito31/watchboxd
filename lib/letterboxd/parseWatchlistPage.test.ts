import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseUsername } from "./parseUsername";
import { parseWatchlistHtml } from "./parseWatchlistPage";

const fixture = readFileSync(
  join(__dirname, "__fixtures__", "watchlist-page.html"),
  "utf-8"
);

describe("parseUsername", () => {
  it("parses plain username", () => {
    expect(parseUsername("JoelHaver")).toBe("joelhaver");
  });

  it("parses profile URL", () => {
    expect(parseUsername("https://letterboxd.com/joelhaver/")).toBe("joelhaver");
  });

  it("rejects invalid input", () => {
    expect(parseUsername("")).toBeNull();
    expect(parseUsername("bad user")).toBeNull();
    expect(parseUsername("https://example.com/foo")).toBeNull();
  });
});

describe("parseWatchlistHtml", () => {
  it("extracts films from LazyPoster markup", () => {
    const films = parseWatchlistHtml(fixture);

    expect(films).toHaveLength(3);
    expect(films[0]).toMatchObject({
      position: 0,
      sourceTitle: "Interstellar",
      sourceSlug: "interstellar",
      sourceYear: 2014,
      resolutionStatus: "pending",
      letterboxdFilmId: 157336,
      slug: "interstellar",
      title: "Interstellar",
      year: 2014,
      url: "https://letterboxd.com/film/interstellar/",
    });
    expect(films[0]?.posterUrl).toContain(
      "157336-interstellar-0-125-0-187-crop.jpg?v=abc12345"
    );
    expect(films[0]?.posterUrls?.length).toBeGreaterThan(1);
    expect(films[0]?.letterboxdPosterUrls).toEqual(films[0]?.posterUrls);
    expect(films.find((f) => f.slug === "inception")).toBeDefined();
    expect(films.find((f) => f.slug === "no-direct-id")).toMatchObject({
      letterboxdFilmId: null,
      resolutionStatus: "pending",
      letterboxdPosterUrls: [
        "https://a.ltrbxd.com/legacy/no-direct-id.jpg",
      ],
    });
    expect(films.find((f) => f.slug === "the-bear")).toBeUndefined();
  });
});
