import type {
  CanonicalResourceKey,
  JobFailure,
  JobStatus,
  JobType,
} from "@/lib/jobs/contracts";

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
  UNAUTHORIZED: "unauthorized",
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

export interface MovieEnrichmentMeta {
  complete: boolean;
  pendingSlugs: string[];
  failedSlugs: string[];
}

export interface ApiCacheMeta {
  cache: "hit" | "stale";
  fetchedAt: string;
  staleAt: string;
  refreshJobs: ApiJobSummary[];
  enrichment?: MovieEnrichmentMeta;
}

export interface ApiDataResponse<T> {
  data: T;
  meta: ApiCacheMeta;
}

export interface ApiAcceptedResponse {
  data: null;
  meta: { cache: "miss"; jobs: ApiJobSummary[] };
}

export interface ApiJobResponse {
  data: ApiJobSummary;
}

export interface ManualJobRequestDto {
  type: JobType;
  identifier: string;
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
  totalPages: number;
}

export interface ProfileSummaryDto {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ProfileDto extends ProfileSummaryDto {
  letterboxdUrl: string;
}

export interface MovieDto {
  letterboxdSlug: string;
  title: string;
  year: number | null;
  letterboxdFilmId: number | null;
  tmdbId: number | null;
  letterboxdPoster: string | null;
  letterboxdRating: number | null;
}

export interface ListItemDto {
  position: number;
  movie: MovieDto;
}

export interface WatchedListItemDto extends ListItemDto {
  userRating: number | null;
}

export interface WatchlistDto {
  user: ProfileSummaryDto;
  items: ListItemDto[];
  filmCount: number;
  pagination: PaginationMeta;
}

export interface WatchedDto {
  user: ProfileSummaryDto;
  items: WatchedListItemDto[];
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

export interface OverlapFilmDto extends MovieDto {
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
