import type {
  NetworkDto,
  PaginationMeta,
  ProfileDto,
  ProfileSummaryDto,
} from "@/lib/api/contracts";
import type {
  CanonicalResourceKey,
  JobFailureCode,
  JobStatus,
  JobType,
} from "@/lib/jobs/contracts";

export interface CacheStamp {
  fetchedAt: Date | null;
  staleAt: Date | null;
}

export interface UserRecord {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  profile: CacheStamp;
  watchlist: CacheStamp;
  watched: CacheStamp;
  network: CacheStamp;
}

export interface MovieRecord {
  letterboxdSlug: string;
  letterboxdFilmId: number | null;
  tmdbId: number | null;
  resolutionStatus: "pending" | "resolved" | "failed";
  title: string;
  year: number | null;
  letterboxdPoster: string | null;
  letterboxdRating: number | null;
  letterboxd: CacheStamp;
  metadata: MovieMetadataRecord | null;
}

export interface GenreRecord {
  id: number;
  name: string;
}

export interface MovieMetadataRecord extends CacheStamp {
  runtimeMinutes: number | null;
  overview: string | null;
  tmdbTitle: string | null;
  originalTitle: string | null;
  originalLanguage: string | null;
  tmdbReleaseDate: Date | null;
  tmdbVoteAverage: number | null;
  tmdbPosterPath: string | null;
  tmdbBackdropPath: string | null;
  genres: GenreRecord[];
}

export interface ListItemRecord {
  position: number;
  movie: MovieRecord;
}

export interface WatchedListItemRecord extends ListItemRecord {
  userRating: number | null;
}

export interface UserListRecord<TItem extends ListItemRecord = ListItemRecord> {
  user: UserRecord;
  items: TItem[];
  total: number;
  pagination: PaginationMeta;
}

export type GenreMode = "any" | "all";
export type RatingMode = "any" | "all";

export interface MovieFilters {
  title?: string;
  letterboxdSlug?: string;
  letterboxdFilmId?: number;
  tmdbId?: number;
  year?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  releaseDateFrom?: Date;
  releaseDateTo?: Date;
  originalLanguage?: string;
  tmdbRatingMin?: number;
  tmdbRatingMax?: number;
  letterboxdRatingMin?: number;
  letterboxdRatingMax?: number;
  genreIds: number[];
  genreNames: string[];
  genreMode: GenreMode;
}

export interface ListQuery {
  page: number;
  pageSize: number;
  includeMetadata: boolean;
  filters: MovieFilters;
}

export interface WatchedListQuery extends ListQuery {
  userRatingMin?: number;
  userRatingMax?: number;
}

export interface WatchedOverlapQuery extends WatchedListQuery {
  ratingMode: RatingMode;
}

export interface OverlapGroupRecord {
  movie: MovieRecord;
  presentFor: ProfileSummaryDto[];
}

export interface WatchedByRecord extends ProfileSummaryDto {
  userRating: number | null;
}

export interface WatchedOverlapGroupRecord {
  movie: MovieRecord;
  watchedBy: WatchedByRecord[];
}

export interface OverlapPageRecord<TGroup> {
  groups: TGroup[];
  pagination: PaginationMeta;
}

export interface NetworkRecord {
  user: UserRecord;
  data: NetworkDto;
}

export interface StoredJobRecord {
  id: string;
  type: JobType;
  resourceKey: CanonicalResourceKey;
  status: JobStatus;
  attempts: number;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorCode: JobFailureCode | null;
}

export interface ApiRepository {
  getUser(username: string): Promise<UserRecord | null>;
  getWatchlist(
    username: string,
    query: ListQuery
  ): Promise<UserListRecord | null>;
  getWatched(
    username: string,
    query: WatchedListQuery
  ): Promise<UserListRecord<WatchedListItemRecord> | null>;
  getNetwork(username: string): Promise<NetworkRecord | null>;
  getMovieByTmdbId(tmdbId: number): Promise<MovieRecord | null>;
  getMovieByLetterboxdSlug(slug: string): Promise<MovieRecord | null>;
  getUsers(usernames: readonly string[]): Promise<UserRecord[]>;
  getWatchlistOverlap(
    usernames: readonly string[],
    query: ListQuery
  ): Promise<OverlapPageRecord<OverlapGroupRecord>>;
  getWatchedOverlap(
    usernames: readonly string[],
    query: WatchedOverlapQuery
  ): Promise<OverlapPageRecord<WatchedOverlapGroupRecord>>;
}

export interface JobGateway {
  ensureJob(type: JobType, identifier: string): Promise<StoredJobRecord>;
  getJob(id: string): Promise<StoredJobRecord | null>;
}

export type ProfileRecordDto = ProfileDto;
