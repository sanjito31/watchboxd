import type {
  CanonicalResourceKey,
  JobFailure,
  JobStatus,
  JobType,
} from "@/lib/jobs/contracts";
import type { PosterSelection } from "@/lib/movies/posters";

export const DEFAULT_PAGE = 1 as const;
export const DEFAULT_PAGE_SIZE = 50 as const;
export const DEFAULT_OVERLAP_PAGE_SIZE = 10 as const;
export const MAX_PAGE_SIZE = 100 as const;
export const MIN_OVERLAP_USERS = 2 as const;
export const MAX_OVERLAP_USERS = 10 as const;

export const API_ERROR_CODES = {
  INVALID_REQUEST: "invalid_request",
  INVALID_USERNAME: "invalid_username",
  INVALID_MOVIE_SLUG: "invalid_movie_slug",
  INVALID_TMDB_ID: "invalid_tmdb_id",
  INVALID_PAGINATION: "invalid_pagination",
  INVALID_OVERLAP_USERS: "invalid_overlap_users",
  RESOURCE_NOT_FOUND: "resource_not_found",
  JOB_NOT_FOUND: "job_not_found",
  RATE_LIMITED: "rate_limited",
  UPSTREAM_UNAVAILABLE: "upstream_unavailable",
  INTERNAL_ERROR: "internal_error",
} as const;
export type ApiErrorCode =
  (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

export interface ApiErrorResponse {
  error: ApiError;
}

export interface ApiJobSummary {
  id: string;
  type: JobType;
  resourceKey: CanonicalResourceKey;
  status: JobStatus;
  attempts: number;
  statusUrl: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: JobFailure | null;
}

export interface ApiCacheMeta {
  cache: "hit" | "stale";
  fetchedAt: string;
  staleAt: string;
  /** Present only when stale data triggered a background refresh. */
  refreshJob?: ApiJobSummary;
}

export interface ApiDataResponse<T> {
  data: T;
  meta: ApiCacheMeta;
}

export interface ApiAcceptedResponse {
  data: null;
  meta: {
    cache: "miss";
    /** At least one job is required; overlap may return several. */
    jobs: ApiJobSummary[];
  };
}

export interface ApiJobResponse {
  data: ApiJobSummary;
}

export type JobApiResponse = ApiJobResponse | ApiErrorResponse;

export type ApiResourceResponse<T> =
  | ApiDataResponse<T>
  | ApiAcceptedResponse
  | ApiErrorResponse;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  /** Kept at 1 for an empty result to preserve the current UI behavior. */
  totalPages: number;
}

export const MOVIE_RESOLUTION_STATUSES = [
  "pending",
  "resolved",
  "unresolved",
  "ambiguous",
] as const;
export type MovieResolutionStatus =
  (typeof MOVIE_RESOLUTION_STATUSES)[number];

export interface ProfileSummaryDto {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ProfileDto extends ProfileSummaryDto {
  letterboxdUrl: string;
}

export interface MovieSummaryDto extends PosterSelection {
  letterboxdFilmId: number | null;
  tmdbId: number | null;
  letterboxdSlug: string;
  letterboxdUrl: string;
  title: string;
  year: number | null;
  resolutionStatus: MovieResolutionStatus;
  letterboxdRating: number | null;
}

export interface MovieDto extends MovieSummaryDto {
  originalTitle: string | null;
  overview: string | null;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  genres: string[];
  tmdbVoteAverage: number | null;
  backdropUrl: string | null;
}

export interface WatchlistItemDto {
  /** Zero-based absolute order in the scraped watchlist snapshot. */
  position: number;
  sourceTitle: string;
  sourceSlug: string;
  sourceYear: number | null;
  resolutionStatus: MovieResolutionStatus;
  movie: MovieSummaryDto;
}

export interface WatchlistDto {
  user: ProfileSummaryDto;
  items: WatchlistItemDto[];
  filmCount: number;
  pagination: PaginationMeta;
}

export interface WatchedItemDto {
  /** Zero-based absolute order in the deduplicated watched snapshot. */
  position: number;
  sourceTitle: string;
  sourceSlug: string;
  sourceYear: number | null;
  resolutionStatus: MovieResolutionStatus;
  movie: MovieSummaryDto;
}

export interface WatchedDto {
  user: ProfileSummaryDto;
  items: WatchedItemDto[];
  filmCount: number;
  pagination: PaginationMeta;
}

export type NetworkMemberDto = ProfileSummaryDto;

export interface NetworkDto {
  username: string;
  user: ProfileSummaryDto;
  mutuals: NetworkMemberDto[];
  following: NetworkMemberDto[];
  truncated: boolean;
}

export interface OverlapFilmDto extends MovieSummaryDto {
  presentFor: ProfileSummaryDto[];
  overlapCount: number;
  partySize: number;
}

export interface OverlapDto {
  users: ProfileSummaryDto[];
  films: OverlapFilmDto[];
  pagination: PaginationMeta;
}

export type ProfileApiResponse = ApiResourceResponse<ProfileDto>;
export type WatchlistApiResponse = ApiResourceResponse<WatchlistDto>;
export type WatchedApiResponse = ApiResourceResponse<WatchedDto>;
export type NetworkApiResponse = ApiResourceResponse<NetworkDto>;
export type MovieApiResponse = ApiResourceResponse<MovieDto>;
export type OverlapApiResponse = ApiResourceResponse<OverlapDto>;
