import { describe, expect, it } from "vitest";
import { isProfileNotFoundError } from "./PartyRoster";

describe("isProfileNotFoundError", () => {
  it("recognizes both job and negative-cache not-found responses", () => {
    expect(isProfileNotFoundError("not_found")).toBe(true);
    expect(isProfileNotFoundError("resource_not_found")).toBe(true);
  });

  it("does not treat temporary provider failures as invalid usernames", () => {
    expect(isProfileNotFoundError("upstream_unavailable")).toBe(false);
    expect(isProfileNotFoundError("rate_limited")).toBe(false);
    expect(isProfileNotFoundError("timeout")).toBe(false);
    expect(isProfileNotFoundError(undefined)).toBe(false);
  });
});
