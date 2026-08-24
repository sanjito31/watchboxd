import {
  DEFAULT_OVERLAP_PAGE_SIZE,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  type ManualJobRequestDto,
  MAX_OVERLAP_USERS,
  MAX_PAGE_SIZE,
  MIN_OVERLAP_USERS,
} from "@/lib/api/contracts";
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
  pagination: ParsedPagination;
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
    pagination: parsePagination(searchParams, DEFAULT_OVERLAP_PAGE_SIZE),
  };
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
