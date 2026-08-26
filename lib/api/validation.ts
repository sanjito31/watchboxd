import {
  DEFAULT_OVERLAP_PAGE_SIZE,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  type ManualJobRequestDto,
  MAX_OVERLAP_USERS,
  MAX_PAGE_SIZE,
  MIN_OVERLAP_USERS,
} from "@/lib/api/contracts";
import type {
  ListQuery,
  MovieFilters,
  WatchedListQuery,
  WatchedOverlapQuery,
} from "@/lib/api/types";
import { isJobType } from "@/lib/jobs/contracts";
import {
  buildTmdbMovieJobIdentifier,
  MAX_TMDB_MOVIE_ID,
  parseMovieJobIdentifier,
} from "@/lib/movies/jobIdentifier";

const RESOURCE_IDENTIFIER_PATTERN = /^[a-z0-9_-]+$/;

export class ApiValidationError extends Error {
  constructor(
    readonly code:
      | "invalid_username"
      | "invalid_movie_slug"
      | "invalid_tmdb_id"
      | "invalid_pagination"
      | "invalid_overlap_users"
      | "invalid_request",
    message: string
  ) {
    super(message);
    this.name = "ApiValidationError";
  }
}

export function parseManualJobRequest(value: unknown): ManualJobRequestDto {
  if (!value || typeof value !== "object") {
    throw new ApiValidationError("invalid_request", "A JSON job body is required");
  }

  const candidate = value as { type?: unknown; identifier?: unknown };
  if (typeof candidate.type !== "string" || !isJobType(candidate.type)) {
    throw new ApiValidationError("invalid_request", "Invalid job type");
  }
  if (typeof candidate.identifier !== "string") {
    throw new ApiValidationError("invalid_request", "Invalid job identifier");
  }

  const type = candidate.type;
  if (type === "movie_metadata") {
    const identifier = candidate.identifier.trim().toLowerCase();
    try {
      const parsed = parseMovieJobIdentifier(identifier);
      if (parsed.kind !== "tmdb") throw new TypeError("Invalid TMDB identifier");
      return {
        type,
        identifier: buildTmdbMovieJobIdentifier(parsed.tmdbId),
      };
    } catch {
      throw new ApiValidationError(
        "invalid_request",
        "Movie metadata jobs require a tmdb_<id> identifier"
      );
    }
  }
  if (type !== "movie") {
    return { type, identifier: normalizeUsername(candidate.identifier) };
  }

  const identifier = candidate.identifier.trim().toLowerCase();
  if (identifier.startsWith("tmdb_")) {
    try {
      const parsed = parseMovieJobIdentifier(identifier);
      if (parsed.kind !== "tmdb") throw new TypeError("Invalid TMDB identifier");
      return {
        type,
        identifier: buildTmdbMovieJobIdentifier(parsed.tmdbId),
      };
    } catch {
      throw new ApiValidationError("invalid_request", "Invalid movie job identifier");
    }
  }
  return { type, identifier: normalizeMovieSlug(identifier) };
}

export function normalizeUsername(value: string): string {
  return normalizeIdentifier(value, "invalid_username", "username");
}

export function normalizeMovieSlug(value: string): string {
  return normalizeIdentifier(value, "invalid_movie_slug", "movie slug");
}

export function parseTmdbMovieId(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ApiValidationError(
      "invalid_tmdb_id",
      "TMDB movie ID must be a positive integer"
    );
  }

  const tmdbId = Number(value);
  if (!Number.isSafeInteger(tmdbId) || tmdbId > MAX_TMDB_MOVIE_ID) {
    throw new ApiValidationError(
      "invalid_tmdb_id",
      `TMDB movie ID must be at most ${MAX_TMDB_MOVIE_ID}`
    );
  }
  return tmdbId;
}

function normalizeIdentifier(
  value: string,
  code: ApiValidationError["code"],
  label: string
): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || !RESOURCE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new ApiValidationError(code, `Invalid ${label}`);
  }
  return normalized;
}

export interface ParsedPagination {
  page: number;
  pageSize: number;
}

export function parsePagination(
  searchParams: URLSearchParams,
  defaultPageSize: number = DEFAULT_PAGE_SIZE
): ParsedPagination {
  const page = parsePositiveInteger(searchParams.get("page"), DEFAULT_PAGE);
  const pageSize = parsePositiveInteger(
    searchParams.get("pageSize"),
    defaultPageSize
  );

  if (pageSize > MAX_PAGE_SIZE) {
    throw new ApiValidationError(
      "invalid_pagination",
      `pageSize must be at most ${MAX_PAGE_SIZE}`
    );
  }

  return { page, pageSize };
}

export function parseOverlapRequest(searchParams: URLSearchParams): {
  users: string[];
  query: ListQuery;
} {
  const usersValue = searchParams.get("users");
  if (!usersValue) {
    throw new ApiValidationError(
      "invalid_overlap_users",
      `users must contain ${MIN_OVERLAP_USERS} to ${MAX_OVERLAP_USERS} usernames`
    );
  }

  const users: string[] = [];
  const seen = new Set<string>();
  for (const raw of usersValue.split(",")) {
    let username: string;
    try {
      username = normalizeUsername(raw);
    } catch {
      throw new ApiValidationError(
        "invalid_overlap_users",
        "users contains an invalid username"
      );
    }
    if (!seen.has(username)) {
      seen.add(username);
      users.push(username);
    }
  }

  if (users.length < MIN_OVERLAP_USERS || users.length > MAX_OVERLAP_USERS) {
    throw new ApiValidationError(
      "invalid_overlap_users",
      `users must contain ${MIN_OVERLAP_USERS} to ${MAX_OVERLAP_USERS} unique usernames`
    );
  }

  return {
    users,
    query: parseListQuery(searchParams, DEFAULT_OVERLAP_PAGE_SIZE),
  };
}

export function parseWatchedOverlapRequest(searchParams: URLSearchParams): {
  users: string[];
  query: WatchedOverlapQuery;
} {
  const parsed = parseOverlapRequest(searchParams);
  return {
    users: parsed.users,
    query: {
      ...parseWatchedListQuery(searchParams, DEFAULT_OVERLAP_PAGE_SIZE),
      ratingMode: parseEnum(searchParams, "ratingMode", ["any", "all"], "any"),
    },
  };
}

export function parseListQuery(
  searchParams: URLSearchParams,
  defaultPageSize: number = DEFAULT_PAGE_SIZE
): ListQuery {
  return {
    ...parsePagination(searchParams, defaultPageSize),
    includeMetadata: parseBoolean(searchParams, "includeMetadata", false),
    filters: parseMovieFilters(searchParams),
  };
}

export function parseWatchedListQuery(
  searchParams: URLSearchParams,
  defaultPageSize: number = DEFAULT_PAGE_SIZE
): WatchedListQuery {
  const query = parseListQuery(searchParams, defaultPageSize);
  const userRatingMin = parseNumber(searchParams, "userRatingMin", 0, 5);
  const userRatingMax = parseNumber(searchParams, "userRatingMax", 0, 5);
  assertRange("userRating", userRatingMin, userRatingMax);
  return { ...query, userRatingMin, userRatingMax };
}

export function parseMovieFilters(searchParams: URLSearchParams): MovieFilters {
  const runtimeMin = parseInteger(searchParams, "runtimeMin", 0);
  const runtimeMax = parseInteger(searchParams, "runtimeMax", 0);
  const tmdbRatingMin = parseNumber(searchParams, "tmdbRatingMin", 0, 10);
  const tmdbRatingMax = parseNumber(searchParams, "tmdbRatingMax", 0, 10);
  const letterboxdRatingMin = parseNumber(
    searchParams,
    "letterboxdRatingMin",
    0,
    5
  );
  const letterboxdRatingMax = parseNumber(
    searchParams,
    "letterboxdRatingMax",
    0,
    5
  );
  assertRange("runtime", runtimeMin, runtimeMax);
  assertRange("tmdbRating", tmdbRatingMin, tmdbRatingMax);
  assertRange(
    "letterboxdRating",
    letterboxdRatingMin,
    letterboxdRatingMax
  );

  const releaseDateFrom = parseDate(searchParams, "releaseDateFrom");
  const releaseDateTo = parseDate(searchParams, "releaseDateTo");
  if (
    releaseDateFrom &&
    releaseDateTo &&
    releaseDateFrom.getTime() > releaseDateTo.getTime()
  ) {
    invalidFilter("releaseDateFrom must be on or before releaseDateTo");
  }

  const title = parseText(searchParams, "title", 200);
  const originalLanguage = parseText(searchParams, "originalLanguage", 20);
  if (originalLanguage && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(originalLanguage)) {
    invalidFilter("originalLanguage must be a language code");
  }

  return {
    title,
    letterboxdSlug: parseOptionalMovieSlug(searchParams),
    letterboxdFilmId: parseInteger(searchParams, "letterboxdFilmId", 1),
    tmdbId: parseInteger(searchParams, "tmdbId", 1, MAX_TMDB_MOVIE_ID),
    year: parseInteger(searchParams, "year", 1870, 3000),
    runtimeMin,
    runtimeMax,
    releaseDateFrom,
    releaseDateTo,
    originalLanguage: originalLanguage?.toLowerCase(),
    tmdbRatingMin,
    tmdbRatingMax,
    letterboxdRatingMin,
    letterboxdRatingMax,
    genreIds: parseIntegerList(searchParams, "genreIds"),
    genreNames: parseTextList(searchParams, "genres"),
    genreMode: parseEnum(searchParams, "genreMode", ["any", "all"], "any"),
  };
}

function parseOptionalMovieSlug(
  searchParams: URLSearchParams
): string | undefined {
  const value = searchParams.get("letterboxdSlug");
  if (value === null) return undefined;
  try {
    return normalizeMovieSlug(value);
  } catch {
    invalidFilter("Invalid letterboxdSlug");
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ApiValidationError(
      "invalid_pagination",
      "page and pageSize must be positive integers"
    );
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ApiValidationError(
      "invalid_pagination",
      "page and pageSize must be safe integers"
    );
  }
  return parsed;
}

function parseBoolean(
  searchParams: URLSearchParams,
  name: string,
  fallback: boolean
): boolean {
  const value = searchParams.get(name);
  if (value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  invalidFilter(`${name} must be true or false`);
}

function parseNumber(
  searchParams: URLSearchParams,
  name: string,
  min: number,
  max: number
): number | undefined {
  const value = searchParams.get(name);
  if (value === null) return undefined;
  if (!value.trim()) invalidFilter(`${name} must be a number`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    invalidFilter(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseInteger(
  searchParams: URLSearchParams,
  name: string,
  min: number,
  max = 2_147_483_647
): number | undefined {
  const parsed = parseNumber(searchParams, name, min, max);
  if (parsed !== undefined && !Number.isInteger(parsed)) {
    invalidFilter(`${name} must be an integer`);
  }
  return parsed;
}

function parseText(
  searchParams: URLSearchParams,
  name: string,
  maxLength: number
): string | undefined {
  const value = searchParams.get(name);
  if (value === null) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    invalidFilter(`${name} must contain 1 to ${maxLength} characters`);
  }
  return normalized;
}

function parseDate(
  searchParams: URLSearchParams,
  name: string
): Date | undefined {
  const value = searchParams.get(name);
  if (value === null) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalidFilter(`${name} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    invalidFilter(`${name} must be a valid date`);
  }
  return date;
}

function parseIntegerList(
  searchParams: URLSearchParams,
  name: string
): number[] {
  const values = parseCsv(searchParams, name);
  const result = values.map((value) => {
    if (!/^[1-9]\d*$/.test(value)) {
      invalidFilter(`${name} must be a comma-separated list of positive integers`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
      invalidFilter(`${name} contains an unsupported integer`);
    }
    return parsed;
  });
  return [...new Set(result)];
}

function parseTextList(searchParams: URLSearchParams, name: string): string[] {
  return [
    ...new Set(
      parseCsv(searchParams, name).map((value) => {
        if (value.length > 100) invalidFilter(`${name} entries are too long`);
        return value.toLowerCase();
      })
    ),
  ];
}

function parseCsv(searchParams: URLSearchParams, name: string): string[] {
  const raw = searchParams.getAll(name);
  if (raw.length === 0) return [];
  const values = raw.flatMap((value) => value.split(",").map((part) => part.trim()));
  if (values.some((value) => !value)) {
    invalidFilter(`${name} must not contain empty values`);
  }
  return values;
}

function parseEnum<const T extends string>(
  searchParams: URLSearchParams,
  name: string,
  allowed: readonly T[],
  fallback: T
): T {
  const value = searchParams.get(name);
  if (value === null) return fallback;
  if (allowed.includes(value as T)) return value as T;
  invalidFilter(`${name} must be one of: ${allowed.join(", ")}`);
}

function assertRange(
  name: string,
  min: number | undefined,
  max: number | undefined
): void {
  if (min !== undefined && max !== undefined && min > max) {
    invalidFilter(`${name}Min must be less than or equal to ${name}Max`);
  }
}

function invalidFilter(message: string): never {
  throw new ApiValidationError("invalid_request", message);
}
