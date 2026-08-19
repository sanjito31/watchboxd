import { ProviderError } from "@/lib/letterboxd/providerErrors";
import {
  PermanentJobError,
  RetryableJobError,
  type JobFailure,
  type JobFailureCode,
} from "./contracts";

const MAX_ERROR_MESSAGE_LENGTH = 500;

export interface ClassifiedJobError {
  failure: JobFailure;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export function classifyJobError(error: unknown): ClassifiedJobError {
  if (error instanceof PermanentJobError) {
    return {
      failure: sanitizeJobFailure(error.code, error.message),
      retryable: false,
    };
  }
  if (error instanceof RetryableJobError) {
    return {
      failure: sanitizeJobFailure(error.code, error.message),
      retryable: true,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  if (error instanceof ProviderError) {
    const code = providerCode(error.kind);
    return {
      failure: sanitizeJobFailure(code, error.message),
      retryable: error.kind !== "not_found" && error.kind !== "configuration",
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  if (error instanceof TypeError) {
    return {
      failure: sanitizeJobFailure("invalid_input", error.message),
      retryable: false,
    };
  }
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return {
      failure: sanitizeJobFailure("timeout", "Upstream request timed out"),
      retryable: true,
    };
  }

  return {
    failure: sanitizeJobFailure(
      "unknown",
      error instanceof Error ? error.message : "Unknown job failure"
    ),
    retryable: true,
  };
}

export function sanitizeJobFailure(
  code: JobFailureCode,
  unsafeMessage: string
): JobFailure {
  const fallback = defaultMessage(code);
  const sanitized = unsafeMessage
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /([?&](?:api[_-]?key|token|key|secret|password)=)[^&\s]+/gi,
      "$1[redacted]"
    )
    .replace(
      /\b(api[_-]?key|token|key|secret|password)=([^\s&]+)/gi,
      "$1=[redacted]"
    )
    .replace(/:\/\/([^:/\s]+):([^@\s]+)@/g, "://$1:[redacted]@")
    .replace(/\s+/g, " ")
    .trim();

  return {
    code,
    message: (sanitized || fallback).slice(0, MAX_ERROR_MESSAGE_LENGTH),
  };
}

function providerCode(kind: ProviderError["kind"]): JobFailureCode {
  switch (kind) {
    case "not_found":
      return "not_found";
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
    case "upstream_unavailable":
    case "configuration":
      return "upstream_unavailable";
  }
}

function defaultMessage(code: JobFailureCode): string {
  switch (code) {
    case "invalid_input":
      return "Invalid job input";
    case "not_found":
      return "Resource not found";
    case "rate_limited":
      return "Upstream rate limited the request";
    case "timeout":
      return "Upstream request timed out";
    case "parse_error":
      return "Unable to parse upstream response";
    case "attempts_exhausted":
      return "Maximum delivery attempts exhausted";
    case "upstream_unavailable":
      return "Upstream service unavailable";
    case "unknown":
      return "Unknown job failure";
  }
}
