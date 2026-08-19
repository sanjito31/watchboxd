import { describe, expect, it } from "vitest";
import { ProviderNotFoundError } from "@/lib/letterboxd/providerErrors";
import { RetryableJobError } from "./contracts";
import { classifyJobError, sanitizeJobFailure } from "./errors";

describe("job error handling", () => {
  it("classifies provider 404s as permanent", () => {
    expect(
      classifyJobError(new ProviderNotFoundError("missing"))
    ).toMatchObject({
      retryable: false,
      failure: { code: "not_found" },
    });
  });

  it("retains retry hints for transient errors", () => {
    expect(
      classifyJobError(
        new RetryableJobError("slow down", {
          code: "rate_limited",
          retryAfterSeconds: 45,
        })
      )
    ).toMatchObject({
      retryable: true,
      retryAfterSeconds: 45,
      failure: { code: "rate_limited" },
    });
  });

  it("redacts credentials and bounds persisted messages", () => {
    const failure = sanitizeJobFailure(
      "unknown",
      `postgres://user:password@example.test/db?api_key=secret\n${"x".repeat(600)}`
    );

    expect(failure.message).not.toContain("password");
    expect(failure.message).not.toContain("secret");
    expect(failure.message.length).toBeLessThanOrEqual(500);
    expect(failure.message).not.toContain("\n");
  });
});
