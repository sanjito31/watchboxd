import { describe, expect, it } from "vitest";
import {
  buildCanonicalResourceKey,
  parseCanonicalResourceKey,
} from "./contracts";

describe("canonical job resource keys", () => {
  it("normalizes supported identifiers", () => {
    expect(buildCanonicalResourceKey("watchlist", " Alice ")).toBe(
      "watchlist:alice"
    );
    expect(buildCanonicalResourceKey("movie", "Some-Film_2")).toBe(
      "movie:some-film_2"
    );
  });

  it("rejects URLs and mismatched or malformed keys", () => {
    expect(() =>
      buildCanonicalResourceKey("profile", "https://letterboxd.com/alice/")
    ).toThrow(TypeError);
    expect(parseCanonicalResourceKey("unknown:alice")).toBeNull();
    expect(parseCanonicalResourceKey("profile:Alice")).toBeNull();
  });
});
