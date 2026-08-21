import { describe, expect, it } from "vitest";
import { DEFAULT_POSTER_PLACEHOLDER_URL } from "./posters";

describe("poster contract", () => {
  it("keeps the local placeholder independent of providers", () => {
    expect(DEFAULT_POSTER_PLACEHOLDER_URL).toBe("/file.svg");
  });
});
