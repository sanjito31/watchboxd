import type {
  ApiAcceptedResponse,
  ApiCacheMeta,
  ApiDataResponse,
  ApiErrorResponse,
  ApiJobResponse,
  ApiJobSummary,
} from "@/lib/api/contracts";

export const DEFAULT_POLL_TIMEOUT_MS = 5 * 60 * 1_000;
export const DEFAULT_POLL_INTERVAL_MS = 1_000;
export const MAX_POLL_INTERVAL_MS = 10_000;

export type V1ApiErrorCode =
  | ApiErrorResponse["error"]["code"]
  | NonNullable<ApiJobSummary["error"]>["code"]
  | "cancelled"
  | "http_error"
  | "invalid_response"
  | "network_error"
  | "timeout";

export class V1ApiError extends Error {
  readonly code: V1ApiErrorCode;
  readonly status?: number;
  readonly recoverable: boolean;

  constructor(
    code: V1ApiErrorCode,
    message: string,
    options: { status?: number; recoverable?: boolean; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "V1ApiError";
    this.code = code;
    this.status = options.status;
    this.recoverable = options.recoverable ?? isRecoverable(code, options.status);
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface V1ResourceResult<T> {
  data: T;
  meta: ApiCacheMeta;
}

export interface V1PollingOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onPending?: (jobs: ApiJobSummary[]) => void;
}

interface JsonResponse {
  response: Response;
  body: unknown;
}

/**
 * Fetches a v1 resource and follows every job returned by a 202 response.
 * The original resource is requested again after all jobs succeed, including
 * when a second wave of jobs is needed (for example, overlap enrichment).
 */
export async function fetchV1Resource<T>(
  resourceUrl: string,
  options: V1PollingOptions = {}
): Promise<V1ResourceResult<T>> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const initialIntervalMs =
    options.initialIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxIntervalMs = options.maxIntervalMs ?? MAX_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? abortableSleep;
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  const controller = new AbortController();
  let timedOut = false;

  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    controller.abort(options.signal.reason);
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Polling timed out", "TimeoutError"));
  }, timeoutMs);

  try {
    let resource = await getJson(resourceUrl, fetcher, controller.signal);
    let pollAttempt = 0;

    while (true) {
      throwIfStopped(controller.signal, timedOut, now(), deadline);

      if (resource.response.status === 200) {
        return parseDataResponse<T>(resource);
      }

      if (resource.response.status !== 202) {
        throw responseError(resource);
      }

      const accepted = parseAcceptedResponse(resource);
      let jobs = accepted.meta.jobs;
      options.onPending?.(jobs);
      let retryAfterMs = parseRetryAfter(
        resource.response.headers.get("Retry-After"),
        now()
      );

      const acceptedFailure = jobs.find((job) => job.status === "failed");
      if (acceptedFailure) {
        throw jobFailure(acceptedFailure);
      }

      while (jobs.some((job) => isActiveJob(job))) {
        const interval = getPollInterval(
          pollAttempt,
          retryAfterMs,
          initialIntervalMs,
          maxIntervalMs
        );
        const remaining = deadline - now();
        if (remaining <= 0) {
          throw timeoutError();
        }

        await sleep(Math.min(interval, remaining), controller.signal);
        throwIfStopped(controller.signal, timedOut, now(), deadline);

        const polled = await Promise.all(
          jobs.map((job) =>
            getJson(job.statusUrl, fetcher, controller.signal).then(
              parseJobResponse
            )
          )
        );
        jobs = polled.map((result) => result.job);
        retryAfterMs = maxDefined(
          polled.map((result) => result.retryAfterMs)
        );
        options.onPending?.(jobs);

        const failed = jobs.find((job) => job.status === "failed");
        if (failed) {
          throw jobFailure(failed);
        }

        pollAttempt += 1;
      }

      resource = await getJson(resourceUrl, fetcher, controller.signal);
      pollAttempt = 0;
    }
  } catch (error) {
    if (error instanceof V1ApiError) throw error;
    if (timedOut || now() >= deadline) throw timeoutError(error);
    if (controller.signal.aborted) {
      throw new V1ApiError("cancelled", "The request was cancelled.", {
        recoverable: true,
        cause: error,
      });
    }
    throw new V1ApiError(
      "network_error",
      "Could not reach the server. Check your connection and try again.",
      { recoverable: true, cause: error }
    );
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now()
): number | undefined {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

export function getPollInterval(
  attempt: number,
  retryAfterMs: number | undefined,
  initialIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxIntervalMs = MAX_POLL_INTERVAL_MS
): number {
  const exponential = Math.min(
    maxIntervalMs,
    initialIntervalMs * 2 ** Math.max(0, attempt)
  );
  return Math.min(maxIntervalMs, retryAfterMs ?? exponential);
}

async function getJson(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal
): Promise<JsonResponse> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    throw error;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new V1ApiError(
      "invalid_response",
      "The server returned an unreadable response.",
      { status: response.status, recoverable: true, cause: error }
    );
  }

  return { response, body };
}

function parseDataResponse<T>({
  response,
  body,
}: JsonResponse): V1ResourceResult<T> {
  if (!isObject(body) || !("data" in body) || !isCacheMeta(body.meta)) {
    throw new V1ApiError(
      "invalid_response",
      "The server returned an incomplete response.",
      { status: response.status, recoverable: true }
    );
  }
  return (body as unknown as ApiDataResponse<T>) satisfies V1ResourceResult<T>;
}

function parseAcceptedResponse({
  response,
  body,
}: JsonResponse): ApiAcceptedResponse {
  if (
    !isObject(body) ||
    body.data !== null ||
    !isObject(body.meta) ||
    body.meta.cache !== "miss" ||
    !Array.isArray(body.meta.jobs) ||
    body.meta.jobs.length === 0 ||
    !body.meta.jobs.every(isJobSummary)
  ) {
    throw new V1ApiError(
      "invalid_response",
      "The server did not provide a pollable background job.",
      { status: response.status, recoverable: true }
    );
  }
  return body as unknown as ApiAcceptedResponse;
}

function parseJobResponse(result: JsonResponse): {
  job: ApiJobSummary;
  retryAfterMs?: number;
} {
  if (result.response.status !== 200) {
    throw responseError(result);
  }
  if (
    !isObject(result.body) ||
    !isObject(result.body.data) ||
    !isJobSummary(result.body.data)
  ) {
    throw new V1ApiError(
      "invalid_response",
      "The server returned an invalid job status.",
      { status: result.response.status, recoverable: true }
    );
  }
  return {
    job: (result.body as unknown as ApiJobResponse).data,
    retryAfterMs: parseRetryAfter(
      result.response.headers.get("Retry-After")
    ),
  };
}

function responseError({ response, body }: JsonResponse): V1ApiError {
  if (
    isObject(body) &&
    isObject(body.error) &&
    typeof body.error.code === "string" &&
    typeof body.error.message === "string"
  ) {
    const error = (body as unknown as ApiErrorResponse).error;
    return new V1ApiError(error.code, error.message, {
      status: response.status,
    });
  }

  return new V1ApiError(
    "http_error",
    `The request failed with status ${response.status}.`,
    { status: response.status }
  );
}

function isCacheMeta(value: unknown): value is ApiCacheMeta {
  return (
    isObject(value) &&
    (value.cache === "hit" || value.cache === "stale") &&
    typeof value.fetchedAt === "string" &&
    typeof value.staleAt === "string"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJobSummary(value: unknown): value is ApiJobSummary {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.statusUrl === "string" &&
    typeof value.resourceKey === "string" &&
    (value.status === "queued" ||
      value.status === "running" ||
      value.status === "succeeded" ||
      value.status === "failed")
  );
}

function isActiveJob(job: ApiJobSummary): boolean {
  return job.status === "queued" || job.status === "running";
}

function jobFailure(job: ApiJobSummary): V1ApiError {
  const code = job.error?.code ?? "http_error";
  return new V1ApiError(
    code,
    job.error?.message ?? "The background job failed.",
    { recoverable: isRecoverable(code) }
  );
}

function maxDefined(values: (number | undefined)[]): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length > 0 ? Math.max(...defined) : undefined;
}

function throwIfStopped(
  signal: AbortSignal,
  timedOut: boolean,
  now: number,
  deadline: number
): void {
  if (timedOut || now >= deadline) throw timeoutError();
  if (signal.aborted) {
    throw new V1ApiError("cancelled", "The request was cancelled.", {
      recoverable: true,
    });
  }
}

function timeoutError(cause?: unknown): V1ApiError {
  return new V1ApiError(
    "timeout",
    "This is taking longer than five minutes. You can try again.",
    { recoverable: true, cause }
  );
}

function isRecoverable(code: V1ApiErrorCode, status?: number): boolean {
  if (code === "invalid_input" || code === "not_found") return false;
  if (code === "invalid_request" || code === "invalid_username") return false;
  if (code === "invalid_movie_slug" || code === "invalid_pagination") {
    return false;
  }
  if (code === "invalid_overlap_users" || code === "resource_not_found") {
    return false;
  }
  return status === undefined || status >= 500 || status === 408 || status === 429;
}

function abortableSleep(
  milliseconds: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
