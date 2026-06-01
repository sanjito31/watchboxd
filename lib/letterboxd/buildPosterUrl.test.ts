import { describe, expect, it } from "vitest";
import {
  buildPosterUrl,
  buildPosterUrlCandidates,
  parseResolvablePosterPath,
  posterSlugVariants,
} from "./buildPosterUrl";

describe("posterSlugVariants", () => {
  it("strips year suffix from slug when year matches", () => {
    expect(posterSlugVariants("running-on-empty-1988", 1988)).toEqual([
      "running-on-empty-1988",
      "running-on-empty",
    ]);
  });
});

describe("buildPosterUrl", () => {
  it("builds CDN URL using watchlist dimensions", () => {
    expect(
      buildPosterUrl("a-better-tomorrow", "film:45272", "4e947183", 125, 187)
    ).toBe(
      "https://a.ltrbxd.com/resized/film-poster/4/5/2/7/2/45272-a-better-tomorrow-0-125-0-187-crop.jpg?v=4e947183"
    );
  });

  it("includes double-dash variant for ambiguous slugs", () => {
    const candidates = buildPosterUrlCandidates(
      "wife-be-like-a-rose",
      "film:77470",
      "d157be7a",
      125,
      187,
      1935
    );
    expect(candidates.some((u) => u.includes("rose--0-"))).toBe(true);
  });
});

describe("parseResolvablePosterPath", () => {
  it("parses HTML-encoded JSON attribute", () => {
    const raw =
      '{&quot;postered&quot;:{&quot;lid&quot;:&quot;1TLW&quot;,&quot;uid&quot;:&quot;film:45272&quot;},&quot;hasDefaultPoster&quot;:true,&quot;cacheBustingKey&quot;:&quot;4e947183&quot;}';
    expect(parseResolvablePosterPath(raw)).toEqual({
      lid: "1TLW",
      uid: "film:45272",
      cacheBustingKey: "4e947183",
      hasDefaultPoster: true,
    });
  });
});
