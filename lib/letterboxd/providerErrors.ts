export type RetryableProviderErrorKind =
  | "rate_limited"
  | "timeout"
  | "upstream_unavailable";
export type PermanentProviderErrorKind = "not_found" | "configuration";
export type ProviderErrorKind =
  | RetryableProviderErrorKind
  | PermanentProviderErrorKind;

export interface ProviderErrorOptions {
  cause?: unknown;
  retryAfterSeconds?: number;
  status?: number;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryAfterSeconds?: number;
  readonly status?: number;

  constructor(
    message: string,
    kind: ProviderErrorKind,
    options: ProviderErrorOptions = {}
  ) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.status = options.status;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export class ProviderPermanentError extends ProviderError {
  readonly kind: PermanentProviderErrorKind;

  constructor(
    message: string,
    kind: PermanentProviderErrorKind,
    options: ProviderErrorOptions = {}
  ) {
    super(message, kind, options);
    this.name = "ProviderPermanentError";
    this.kind = kind;
  }
}

/**
 * A permanent upstream miss. Callers can use this classification to apply the
 * frozen one-hour negative-cache policy without inspecting an error message.
 */
export class ProviderNotFoundError extends ProviderPermanentError {
  constructor(message: string, options: ProviderErrorOptions = {}) {
    super(message, "not_found", options);
    this.name = "ProviderNotFoundError";
  }
}

export function isProviderNotFoundError(
  error: unknown
): error is ProviderNotFoundError {
  return (
    error instanceof ProviderNotFoundError ||
    (error instanceof ProviderError && error.kind === "not_found")
  );
}
