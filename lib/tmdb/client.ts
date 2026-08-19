import { FETCH_RETRIES, FETCH_TIMEOUT_MS } from "@/lib/letterboxd/constants";
import {
  ProviderError,
  ProviderPermanentError,
} from "@/lib/letterboxd/providerErrors";
import { TmdbConfigurationError, TmdbNotFoundError } from "./errors";
import type {
  TmdbMovieDetails,
  TmdbMovieProvider,
  TmdbSearchResponse,
} from "./types";

export const TMDB_API_BASE_URL = "https://api.themoviedb.org/3" as const;

export type TmdbCredential =
  | { kind: "bearer"; value: string }
  | { kind: "api_key"; value: string };

export interface TmdbEnvironment {
  TMDB_API_READ_TOKEN?: string;
  TMDB_API_KEY?: string;
}

export interface TmdbClientOptions {
  env?: TmdbEnvironment;
  fetch?: typeof fetch;
  retries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}

export function resolveTmdbCredential(
  env: TmdbEnvironment = {
    TMDB_API_READ_TOKEN: process.env.TMDB_API_READ_TOKEN,
    TMDB_API_KEY: process.env.TMDB_API_KEY,
  }
): TmdbCredential {
  const readToken = env.TMDB_API_READ_TOKEN?.trim();
  if (readToken) return { kind: "bearer", value: readToken };

  const apiKey = env.TMDB_API_KEY?.trim();
  if (apiKey) return { kind: "api_key", value: apiKey };

  throw new TmdbConfigurationError();
}

export class TmdbClient implements TmdbMovieProvider {
  private readonly credential: TmdbCredential;
  private readonly fetcher: typeof fetch;
  private readonly retries: number;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(options: TmdbClientOptions = {}) {
    this.credential = resolveTmdbCredential(options.env);
    this.fetcher = options.fetch ?? fetch;
    this.retries = options.retries ?? FETCH_RETRIES;
    this.timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.retryDelayMs = options.retryDelayMs ?? 400;
  }

  searchMovies(
    title: string,
    year?: number | null
  ): Promise<TmdbSearchResponse> {
    const query: Record<string, string> = {
      query: title,
      include_adult: "false",
      language: "en-US",
      page: "1",
    };
    if (year !== null && year !== undefined) {
      query.primary_release_year = String(year);
    }
    return this.request<TmdbSearchResponse>("/search/movie", query);
  }

  getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails> {
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
      throw new TypeError("TMDB movie ID must be a positive integer");
    }
    return this.request<TmdbMovieDetails>(`/movie/${tmdbId}`, {
      language: "en-US",
    });
  }

  private async request<T>(
    path: string,
    query: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${TMDB_API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const headers = new Headers({ Accept: "application/json" });
    if (this.credential.kind === "bearer") {
      headers.set("Authorization", `Bearer ${this.credential.value}`);
    } else {
      url.searchParams.set("api_key", this.credential.value);
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetcher(url, {
          headers,
          signal: controller.signal,
          cache: "no-store",
        });

        if (response.status === 404) {
          throw new TmdbNotFoundError(path);
        }

        if (response.status === 401 || response.status === 403) {
          throw new ProviderPermanentError(
            `TMDB authentication failed with HTTP ${response.status}`,
            "configuration",
            { status: response.status }
          );
        }

        if (!response.ok) {
          const retryAfterSeconds = parseRetryAfter(
            response.headers.get("Retry-After")
          );
          throw new ProviderError(
            `TMDB request failed with HTTP ${response.status}`,
            response.status === 429 ? "rate_limited" : "upstream_unavailable",
            { status: response.status, retryAfterSeconds }
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        if (
          error instanceof TmdbNotFoundError ||
          error instanceof ProviderPermanentError
        ) {
          throw error;
        }

        const normalized =
          error instanceof ProviderError
            ? error
            : new ProviderError(
                controller.signal.aborted
                  ? "TMDB request timed out"
                  : "TMDB request failed",
                controller.signal.aborted ? "timeout" : "upstream_unavailable",
                { cause: error }
              );
        lastError = normalized;

        if (attempt < this.retries) {
          const retryAfterMs =
            normalized.retryAfterSeconds === undefined
              ? this.retryDelayMs * (attempt + 1)
              : normalized.retryAfterSeconds * 1_000;
          await sleep(retryAfterMs);
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw (
      lastError ??
      new ProviderError("TMDB request failed", "upstream_unavailable")
    );
  }
}

export function createTmdbClient(options: TmdbClientOptions = {}): TmdbClient {
  return new TmdbClient(options);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
