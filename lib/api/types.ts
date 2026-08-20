import type {
  MovieResolutionStatus,
  NetworkDto,
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
  resolutionStatus: MovieResolutionStatus;
  title: string;
  year: number | null;
  tmdbTitle: string | null;
  tmdbOriginalTitle: string | null;
  tmdbOverview: string | null;
  tmdbReleaseDate: Date | null;
  tmdbRuntimeMinutes: number | null;
  tmdbGenres: string[];
  tmdbVoteAverage: number | null;
  tmdbPosterPath: string | null;
  tmdbBackdropPath: string | null;
  letterboxdPosterUrls: string[];
  letterboxdRating: number | null;
  tmdb: CacheStamp;
  letterboxd: CacheStamp;
}

export interface ListItemRecord {
  position: number;
  sourceTitle: string;
  sourceSlug: string;
  sourceYear: number | null;
  resolutionStatus: MovieResolutionStatus;
  movie: MovieRecord;
}

export interface UserListRecord {
  user: UserRecord;
  items: ListItemRecord[];
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
  getWatchlist(username: string): Promise<UserListRecord | null>;
  getWatched(username: string): Promise<UserListRecord | null>;
  getNetwork(username: string): Promise<NetworkRecord | null>;
  getMovieByTmdbId(tmdbId: number): Promise<MovieRecord | null>;
  getMovieByLetterboxdSlug(slug: string): Promise<MovieRecord | null>;
  getWatchlists(usernames: readonly string[]): Promise<UserListRecord[]>;
}

export interface JobGateway {
  ensureJob(type: JobType, identifier: string): Promise<StoredJobRecord>;
  getJob(id: string): Promise<StoredJobRecord | null>;
}

export interface OverlapGroupRecord {
  movie: MovieRecord;
  presentFor: ProfileSummaryDto[];
}

export type ProfileRecordDto = ProfileDto;
