import { describe, expect, it } from "vitest";
import { computeRankedOverlap, paginate } from "./intersection";
import type { Film, PartyMember } from "./types";

const alice: PartyMember = { username: "alice", displayName: "Alice" };
const bob: PartyMember = { username: "bob", displayName: "Bob" };
const carol: PartyMember = { username: "carol", displayName: "Carol" };
const dave: PartyMember = { username: "dave", displayName: "Dave" };
const eve: PartyMember = { username: "eve", displayName: "Eve" };

const film = (slug: string): Film => ({
  slug,
  title: slug,
  url: `https://letterboxd.com/film/${slug}/`,
});

describe("computeRankedOverlap", () => {
  it("requires at least two party members", () => {
    const watchlists = new Map([["alice", [film("a")]]]);
    expect(computeRankedOverlap(watchlists, [alice])).toEqual([]);
  });

  it("includes films on at least two watchlists, ranked by overlap", () => {
    const watchlists = new Map<string, Film[]>([
      ["alice", [film("four"), film("two-a"), film("solo")]],
      ["bob", [film("four"), film("two-a"), film("two-b")]],
      ["carol", [film("four"), film("two-b")]],
      ["dave", [film("four")]],
      ["eve", [film("two-b")]],
    ]);

    const result = computeRankedOverlap(
      watchlists,
      [alice, bob, carol, dave, eve]
    );

    expect(result.map((r) => r.slug)).toEqual([
      "four",
      "two-b",
      "two-a",
    ]);
    expect(result[0]?.overlapCount).toBe(4);
    expect(result[1]?.overlapCount).toBe(3);
    expect(result[0]?.partySize).toBe(5);
    expect(result.find((r) => r.slug === "solo")).toBeUndefined();
  });
});

describe("paginate", () => {
  it("returns up to pageSize items", () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const page1 = paginate(items, 1, 10);
    expect(page1.items).toHaveLength(10);
    expect(page1.totalPages).toBe(3);
    expect(page1.total).toBe(25);

    const page3 = paginate(items, 3, 10);
    expect(page3.items).toHaveLength(5);
  });
});
