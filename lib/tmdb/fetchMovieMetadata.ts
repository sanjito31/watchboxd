import { computeStaleAt } from "@/lib/cache/policy";
import {
  ProviderError,
  ProviderNotFoundError,
  ProviderPermanentError,
} from "@/lib/letterboxd/providerErrors";
import { MAX_TMDB_MOVIE_ID } from "@/lib/movies/jobIdentifier";
import type { TmdbGenre, TmdbMovieMetadataSnapshot } from "./types";

const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_FETCH_TIMEOUT_MS = 20_000;

interface TmdbMovieDetailsResponse {
  id?: unknown;
  runtime?: unknown;
  overview?: unknown;
  title?: unknown;
  original_title?: unknown;
  original_language?: unknown;
  release_date?: unknown;
  vote_average?: unknown;
  poster_path?: unknown;
  backdrop_path?: unknown;
  genres?: unknown;
}

export async function fetchTmdbMovieMetadata(
  tmdbId: number,
  options: {
    accessToken?: string;
    fetcher?: typeof fetch;
    now?: () => Date;
  } = {}
): Promise<TmdbMovieMetadataSnapshot> {
  assertTmdbId(tmdbId);
  const accessToken = options.accessToken ?? process.env.TMDB_API_READ_TOKEN;
  if (!accessToken?.trim()) {
    throw new ProviderPermanentError(
      "TMDB_API_READ_TOKEN is not configured",
      "configuration"
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TMDB_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `${TMDB_API_BASE_URL}/movie/${tmdbId}?language=en-US`,
      {
        headers: {
          Authorization: `Bearer ${accessToken.trim()}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      }
    );
  } catch (error) {
    throw new ProviderError(
      controller.signal.aborted
        ? "TMDB request timed out"
        : "TMDB request failed",
      controller.signal.aborted ? "timeout" : "upstream_unavailable",
      { cause: error }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    throw new ProviderNotFoundError(`TMDB movie ${tmdbId} was not found`, {
      status: response.status,
    });
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderPermanentError(
      "TMDB rejected the configured API read access token",
      "configuration",
      { status: response.status }
    );
  }
  if (!response.ok) {
    throw new ProviderError(
      `TMDB request failed with HTTP ${response.status}`,
      response.status === 429 ? "rate_limited" : "upstream_unavailable",
      {
        status: response.status,
        retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
      }
    );
  }

  let body: TmdbMovieDetailsResponse;
  try {
    body = (await response.json()) as TmdbMovieDetailsResponse;
  } catch (error) {
    throw parseError("TMDB returned invalid JSON", error);
  }
  if (!body || typeof body !== "object" || body.id !== tmdbId) {
    throw parseError("TMDB returned an unexpected movie payload");
  }

  const fetchedAt = options.now?.() ?? new Date();
  return {
    tmdbId,
    runtimeMinutes: nullableNonNegativeInteger(body.runtime, "runtime"),
    overview: nullableString(body.overview, "overview"),
    tmdbTitle: nullableString(body.title, "title"),
    originalTitle: nullableString(body.original_title, "original_title"),
    originalLanguage: nullableString(
      body.original_language,
      "original_language"
    ),
    tmdbReleaseDate: nullableDate(body.release_date),
    tmdbVoteAverage: nullableVoteAverage(body.vote_average),
    tmdbPosterPath: nullableString(body.poster_path, "poster_path"),
    tmdbBackdropPath: nullableString(body.backdrop_path, "backdrop_path"),
    genres: parseGenres(body.genres),
    tmdbFetchedAt: fetchedAt,
    tmdbStaleAt: computeStaleAt("movieMetadata", fetchedAt),
  };
}

function assertTmdbId(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_TMDB_MOVIE_ID
  ) {
    throw new TypeError("TMDB movie ID is outside the supported range");
  }
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw parseError(`TMDB field ${field} was not a string`);
  }
  return value;
}

function nullableNonNegativeInteger(
  value: unknown,
  field: string
): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw parseError(`TMDB field ${field} was not a non-negative integer`);
  }
  return value as number;
}

function nullableVoteAverage(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10) {
    throw parseError("TMDB field vote_average was outside the supported range");
  }
  return value;
}

function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw parseError("TMDB field release_date was not an ISO date");
  }
  const result = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) {
    throw parseError("TMDB field release_date was not a valid date");
  }
  return result;
}

function parseGenres(value: unknown): TmdbGenre[] {
  if (!Array.isArray(value)) throw parseError("TMDB genres were missing");
  const genres = value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw parseError("TMDB returned an invalid genre");
    }
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (!Number.isInteger(id) || (id as number) <= 0 || typeof name !== "string" || !name.trim()) {
      throw parseError("TMDB returned an invalid genre");
    }
    return { id: id as number, name: name.trim() };
  });
  return [...new Map(genres.map((genre) => [genre.id, genre])).values()];
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isNaN(date)
    ? undefined
    : Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}

function parseError(message: string, cause?: unknown): ProviderPermanentError {
  return new ProviderPermanentError(message, "parse_error", { cause });
}
