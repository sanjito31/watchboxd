import { describe, expect, it } from "vitest";
import {
  buildCanonicalResourceKey,
  isJobId,
  isScrapeQueueMessageV1,
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

describe("scrape queue message v1", () => {
  const jobId = "11111111-1111-4111-8111-111111111111";

  it("accepts the exact versioned payload with a database UUID", () => {
    expect(isJobId(jobId)).toBe(true);
    expect(isScrapeQueueMessageV1({ version: 1, jobId })).toBe(true);
  });

  it("rejects malformed IDs, versions, and additional payload fields", () => {
    expect(isJobId("job-1")).toBe(false);
    expect(isScrapeQueueMessageV1({ version: 1, jobId: "job-1" })).toBe(
      false
    );
    expect(isScrapeQueueMessageV1({ version: 2, jobId })).toBe(false);
    expect(
      isScrapeQueueMessageV1({ version: 1, jobId, resourceKey: "profile:a" })
    ).toBe(false);
  });
});
