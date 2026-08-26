import { describe, expect, it } from "vitest";
import {
  CACHE_TTL_MS,
  classifyFreshness,
  computeStaleAt,
} from "./policy";

describe("cache policy", () => {
  const fetchedAt = new Date("2026-08-19T12:00:00.000Z");

  it("freezes the resource TTLs from the implementation plan", () => {
    expect(CACHE_TTL_MS).toEqual({
      profile: 24 * 60 * 60 * 1_000,
      network: 24 * 60 * 60 * 1_000,
      watchlist: 6 * 60 * 60 * 1_000,
      watched: 6 * 60 * 60 * 1_000,
      movie: 24 * 60 * 60 * 1_000,
      movieMetadata: 90 * 24 * 60 * 60 * 1_000,
      notFound: 60 * 60 * 1_000,
    });
  });

  it("computes expiry and treats the exact boundary as stale", () => {
    const staleAt = computeStaleAt("watchlist", fetchedAt);

    expect(staleAt.toISOString()).toBe("2026-08-19T18:00:00.000Z");
    expect(
      classifyFreshness(
        { fetchedAt, staleAt },
        new Date("2026-08-19T17:59:59.999Z")
      )
    ).toBe("fresh");
    expect(classifyFreshness({ fetchedAt, staleAt }, staleAt)).toBe("stale");
  });

  it("classifies incomplete snapshots as missing", () => {
    expect(classifyFreshness(null, fetchedAt)).toBe("missing");
    expect(
      classifyFreshness({ fetchedAt, staleAt: null }, fetchedAt)
    ).toBe("missing");
  });
});
