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

  it("classifies transaction-start pool contention as a retryable timeout", () => {
    expect(
      classifyJobError({
        code: "P2028",
        message:
          "Transaction API error: Unable to start a transaction in the given time.",
      })
    ).toEqual({
      retryable: true,
      failure: {
        code: "timeout",
        message: "Database transaction capacity was temporarily unavailable",
      },
    });
  });

  it("does not retry Prisma void-result deserialization failures", () => {
    const error = Object.assign(
      new Error(
        "Raw query failed. Failed to deserialize column of type 'void'."
      ),
      { code: "P2010" }
    );

    expect(classifyJobError(error)).toEqual({
      retryable: false,
      failure: {
        code: "unknown",
        message: "Database query returned an unsupported void result",
      },
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
