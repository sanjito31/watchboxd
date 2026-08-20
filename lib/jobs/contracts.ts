export const SCRAPE_QUEUE_TOPIC = "scrape-jobs-v1" as const;
export const SCRAPE_QUEUE_MESSAGE_VERSION = 1 as const;
export const SCRAPE_QUEUE_RETENTION_SECONDS = 7 * 24 * 60 * 60;
export const MAX_JOB_DELIVERIES = 5 as const;

export const JOB_ENVIRONMENTS = [
  "development",
  "preview",
  "production",
] as const;
export type JobEnvironment = (typeof JOB_ENVIRONMENTS)[number];

export const JOB_TYPES = [
  "profile",
  "watchlist",
  "watched",
  "network",
  "movie",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ACTIVE_JOB_STATUSES = ["queued", "running"] as const satisfies
  readonly JobStatus[];
export type ActiveJobStatus = (typeof ACTIVE_JOB_STATUSES)[number];

export interface ScrapeQueueMessageV1 {
  version: typeof SCRAPE_QUEUE_MESSAGE_VERSION;
  jobId: string;
}

export interface JobIdentity<TType extends JobType = JobType> {
  environment: JobEnvironment;
  type: TType;
  resourceKey: CanonicalResourceKey<TType>;
}

export type CanonicalResourceKey<TType extends JobType = JobType> =
  `${TType}:${string}`;

const RESOURCE_IDENTIFIER_PATTERN = /^[a-z0-9_-]+$/;
const JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Builds the semantic job key. Callers may pass mixed case, but must pass a
 * bare Letterboxd username or film slug rather than a URL or @-prefixed value.
 */
export function buildCanonicalResourceKey<TType extends JobType>(
  type: TType,
  identifier: string
): CanonicalResourceKey<TType> {
  const normalized = identifier.trim().toLowerCase();

  if (!normalized || !RESOURCE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new TypeError(`Invalid ${type} resource identifier`);
  }

  return `${type}:${normalized}`;
}

export function parseCanonicalResourceKey(
  resourceKey: string
): { type: JobType; identifier: string } | null {
  const separator = resourceKey.indexOf(":");
  if (separator < 1) return null;

  const type = resourceKey.slice(0, separator);
  const identifier = resourceKey.slice(separator + 1);

  if (
    !isJobType(type) ||
    !identifier ||
    !RESOURCE_IDENTIFIER_PATTERN.test(identifier)
  ) {
    return null;
  }

  return { type, identifier };
}

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}

export function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

export function isJobId(value: unknown): value is string {
  return typeof value === "string" && JOB_ID_PATTERN.test(value);
}

export function isScrapeQueueMessageV1(
  value: unknown
): value is ScrapeQueueMessageV1 {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<ScrapeQueueMessageV1>;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 2 &&
    keys[0] === "jobId" &&
    keys[1] === "version" &&
    candidate.version === SCRAPE_QUEUE_MESSAGE_VERSION &&
    isJobId(candidate.jobId)
  );
}

export const JOB_FAILURE_CODES = [
  "invalid_input",
  "not_found",
  "upstream_unavailable",
  "rate_limited",
  "timeout",
  "parse_error",
  "attempts_exhausted",
  "unknown",
] as const;
export type JobFailureCode = (typeof JOB_FAILURE_CODES)[number];

export interface JobFailure {
  code: JobFailureCode;
  message: string;
}

export interface JobErrorOptions {
  code?: JobFailureCode;
  cause?: unknown;
}

export interface RetryableJobErrorOptions extends JobErrorOptions {
  retryAfterSeconds?: number;
}

/** Signals that the queue delivery should be retried when attempts remain. */
export class RetryableJobError extends Error {
  readonly code: JobFailureCode;
  readonly retryAfterSeconds?: number;

  constructor(message: string, options: RetryableJobErrorOptions = {}) {
    super(message);
    this.name = "RetryableJobError";
    this.code = options.code ?? "upstream_unavailable";
    this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** Signals that the failed job must be recorded and the delivery acknowledged. */
export class PermanentJobError extends Error {
  readonly code: JobFailureCode;

  constructor(message: string, options: JobErrorOptions = {}) {
    super(message);
    this.name = "PermanentJobError";
    this.code = options.code ?? "invalid_input";
    if (options.cause !== undefined) this.cause = options.cause;
  }
}
