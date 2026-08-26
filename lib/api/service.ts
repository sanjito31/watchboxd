import type {
  ApiAcceptedResponse,
  ApiDataResponse,
  ApiErrorResponse,
  ApiJobResponse,
  ApiJobSummary,
  ListItemDto,
  FullMovieDto,
  MovieEnrichmentMeta,
  MovieMetadataDto,
  MovieDto,
  NetworkDto,
  OverlapDto,
  OverlapFilmDto,
  PaginationMeta,
  ProfileDto,
  ProfileSummaryDto,
  WatchedDto,
  WatchedOverlapDto,
  WatchedOverlapFilmDto,
  WatchedListItemDto,
  WatchlistDto,
} from "@/lib/api/contracts";
import { classifyFreshness } from "@/lib/cache/policy";
import type { JobFailureCode, JobType } from "@/lib/jobs/contracts";
import { buildTmdbMovieJobIdentifier } from "@/lib/movies/jobIdentifier";
import type {
  ApiRepository,
  CacheStamp,
  JobGateway,
  ListQuery,
  ListItemRecord,
  MovieRecord,
  OverlapGroupRecord,
  StoredJobRecord,
  UserListRecord,
  UserRecord,
  WatchedListItemRecord,
  WatchedListQuery,
  WatchedOverlapGroupRecord,
  WatchedOverlapQuery,
} from "@/lib/api/types";

type ResourceResult<T> =
  | ApiDataResponse<T>
  | ApiAcceptedResponse
  | ApiErrorResponse;

const LETTERBOXD_BASE_URL = "https://letterboxd.com";

export class ApiService {
  constructor(
    private readonly repository: ApiRepository,
    private readonly jobs: JobGateway,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getProfile(username: string): Promise<ResourceResult<ProfileDto>> {
    const user = await this.repository.getUser(username);
    if (!user || classifyFreshness(user.profile, this.now()) === "missing") {
      return this.missOrNotFound("profile", username);
    }
    return this.cachedResource(
      {
        ...toProfileSummary(user),
        letterboxdUrl: `${LETTERBOXD_BASE_URL}/${user.username}/`,
      },
      user.profile,
      "profile",
      username
    );
  }

  async getWatchlist(
    username: string,
    query: ListQuery
  ): Promise<ResourceResult<WatchlistDto>> {
    const list = await this.repository.getWatchlist(username, query);
    if (!list || classifyFreshness(list.user.watchlist, this.now()) === "missing") {
      return this.missOrNotFound("watchlist", username);
    }
    return this.listResponse(
      list,
      "watchlist",
      username,
      (item) => toListItem(item, query.includeMetadata)
    );
  }

  async getWatched(
    username: string,
    query: WatchedListQuery
  ): Promise<ResourceResult<WatchedDto>> {
    const list = await this.repository.getWatched(username, query);
    if (!list || classifyFreshness(list.user.watched, this.now()) === "missing") {
      return this.missOrNotFound("watched", username);
    }
    return this.listResponse(
      list,
      "watched",
      username,
      (item) => toWatchedListItem(item, query.includeMetadata)
    );
  }

  async getNetwork(username: string): Promise<ResourceResult<NetworkDto>> {
    const network = await this.repository.getNetwork(username);
    const profileMissing =
      !network || classifyFreshness(network.user.profile, this.now()) === "missing";
    const networkMissing =
      !network || classifyFreshness(network.user.network, this.now()) === "missing";
    if (profileMissing || networkMissing) {
      const jobs = await Promise.all([
        ...(profileMissing ? [this.jobs.ensureJob("profile", username)] : []),
        ...(networkMissing ? [this.jobs.ensureJob("network", username)] : []),
      ]);
      const failed = jobs.find((job) => job.status === "failed");
      return failed ? failedJobResponse(failed) : accepted(jobs);
    }
    return this.cachedResource(
      network.data,
      network.user.network,
      "network",
      username
    );
  }

  async getMovie(tmdbId: number): Promise<ResourceResult<FullMovieDto>> {
    const identifier = buildTmdbMovieJobIdentifier(tmdbId);
    return this.movieResponse(
      await this.repository.getMovieByTmdbId(tmdbId),
      identifier
    );
  }

  async getMovieByLetterboxdSlug(
    slug: string
  ): Promise<ResourceResult<FullMovieDto>> {
    return this.movieResponse(
      await this.repository.getMovieByLetterboxdSlug(slug),
      slug
    );
  }

  async getOverlap(
    usernames: readonly string[],
    query: ListQuery
  ): Promise<ResourceResult<OverlapDto>> {
    const users = await this.repository.getUsers(usernames);
    const byUsername = new Map(users.map((user) => [user.username, user]));
    const missing = usernames.filter((username) => {
      const user = byUsername.get(username);
      return !user || classifyFreshness(user.watchlist, this.now()) === "missing";
    });
    if (missing.length > 0) {
      const jobs = await Promise.all(
        missing.map((username) => this.jobs.ensureJob("watchlist", username))
      );
      const failed = jobs.find((job) => job.status === "failed");
      return failed ? failedJobResponse(failed) : accepted(jobs);
    }

    const orderedUsers = usernames.map(
      (username) => byUsername.get(username) as UserRecord
    );
    const profiles = orderedUsers.map(toProfileSummary);
    const page = await this.repository.getWatchlistOverlap(usernames, query);
    const data: OverlapDto = {
      users: profiles,
      films: page.groups.map((group) =>
        toOverlapFilm(group, profiles.length, query.includeMetadata)
      ),
      pagination: page.pagination,
    };
    const stamp = aggregateStamps(orderedUsers.map((user) => user.watchlist));
    const refreshJobs = await this.refreshStaleResources([
      ...orderedUsers.map((user) => ({
        stamp: user.watchlist,
        type: "watchlist" as const,
        identifier: user.username,
      })),
    ]);
    return cached(
      data,
      stamp,
      refreshJobs,
      movieEnrichmentMeta(page.groups.map((group) => group.movie))
    );
  }

  async getWatchedOverlap(
    usernames: readonly string[],
    query: WatchedOverlapQuery
  ): Promise<ResourceResult<WatchedOverlapDto>> {
    const users = await this.repository.getUsers(usernames);
    const byUsername = new Map(users.map((user) => [user.username, user]));
    const missing = usernames.filter((username) => {
      const user = byUsername.get(username);
      return !user || classifyFreshness(user.watched, this.now()) === "missing";
    });
    if (missing.length > 0) {
      const jobs = await Promise.all(
        missing.map((username) => this.jobs.ensureJob("watched", username))
      );
      const failed = jobs.find((job) => job.status === "failed");
      return failed ? failedJobResponse(failed) : accepted(jobs);
    }

    const orderedUsers = usernames.map(
      (username) => byUsername.get(username) as UserRecord
    );
    const page = await this.repository.getWatchedOverlap(usernames, query);
    const data: WatchedOverlapDto = {
      users: orderedUsers.map(toProfileSummary),
      films: page.groups.map((group) =>
        toWatchedOverlapFilm(group, orderedUsers.length, query.includeMetadata)
      ),
      pagination: page.pagination,
    };
    const stamp = aggregateStamps(orderedUsers.map((user) => user.watched));
    const refreshJobs = await this.refreshStaleResources(
      orderedUsers.map((user) => ({
        stamp: user.watched,
        type: "watched" as const,
        identifier: user.username,
      }))
    );
    return cached(
      data,
      stamp,
      refreshJobs,
      movieEnrichmentMeta(page.groups.map((group) => group.movie))
    );
  }

  async getJob(id: string): Promise<ApiJobResponse | ApiErrorResponse> {
    const job = await this.jobs.getJob(id);
    return job
      ? { data: toJobSummary(job) }
      : { error: { code: "job_not_found", message: "Job not found" } };
  }

  async requestJob(
    type: JobType,
    identifier: string
  ): Promise<ApiAcceptedResponse | ApiErrorResponse> {
    const job = await this.jobs.ensureJob(type, identifier);
    return job.status === "failed" ? failedJobResponse(job) : accepted([job]);
  }

  private async listResponse<
    TRecord extends ListItemRecord,
    TDto extends ListItemDto,
  >(
    list: UserListRecord<TRecord>,
    kind: "watchlist" | "watched",
    username: string,
    mapItem: (item: TRecord) => TDto
  ): Promise<
    ResourceResult<{
      user: ProfileSummaryDto;
      items: TDto[];
      filmCount: number;
      pagination: PaginationMeta;
    }>
  > {
    const pageMovies = list.items.map((item) => item.movie);

    const listStamp =
      kind === "watchlist" ? list.user.watchlist : list.user.watched;
    const data = {
      user: toProfileSummary(list.user),
      items: list.items.map(mapItem),
      filmCount: list.total,
      pagination: list.pagination,
    };
    const refreshJobs = await this.refreshStaleResources([
      { stamp: listStamp, type: kind, identifier: username },
    ]);
    return cached(
      data,
      listStamp,
      refreshJobs,
      movieEnrichmentMeta(pageMovies)
    );
  }

  private async movieResponse(
    movie: MovieRecord | null,
    identifier: string
  ): Promise<ResourceResult<FullMovieDto>> {
    if (!movie || movie.resolutionStatus !== "resolved") {
      return this.missOrNotFound("movie", identifier);
    }
    const refreshJobs = await this.refreshStaleResources([
      {
        stamp: movie.letterboxd,
        type: "movie",
        identifier: movie.letterboxdSlug,
      },
    ]);
    if (
      movie.tmdbId !== null &&
      classifyFreshness(movie.metadata, this.now()) !== "fresh"
    ) {
      refreshJobs.push(
        await this.jobs.ensureJob(
          "movie_metadata",
          buildTmdbMovieJobIdentifier(movie.tmdbId)
        )
      );
    }
    return cached(toFullMovieDto(movie), movie.letterboxd, refreshJobs);
  }

  private async refreshStaleResources(
    resources: readonly {
      stamp: CacheStamp;
      type: JobType;
      identifier: string;
    }[]
  ): Promise<StoredJobRecord[]> {
    const stale = resources.filter(
      ({ stamp }) => classifyFreshness(stamp, this.now()) === "stale"
    );
    const unique = [
      ...new Map(
        stale.map((resource) => [
          `${resource.type}:${resource.identifier}`,
          resource,
        ])
      ).values(),
    ];
    return Promise.all(
      unique.map((resource) =>
        this.jobs.ensureJob(resource.type, resource.identifier)
      )
    );
  }

  private async cachedResource<T>(
    data: T,
    stamp: CacheStamp,
    type: JobType,
    identifier: string
  ): Promise<ApiDataResponse<T>> {
    const jobs =
      classifyFreshness(stamp, this.now()) === "stale"
        ? [await this.jobs.ensureJob(type, identifier)]
        : [];
    return cached(data, stamp, jobs);
  }

  private async missOrNotFound(
    type: JobType,
    identifier: string
  ): Promise<ApiAcceptedResponse | ApiErrorResponse> {
    const job = await this.jobs.ensureJob(type, identifier);
    return job.status === "failed" ? failedJobResponse(job) : accepted([job]);
  }
}

function cached<T>(
  data: T,
  stamp: CacheStamp,
  refreshJobs: readonly StoredJobRecord[],
  enrichment?: MovieEnrichmentMeta
): ApiDataResponse<T> {
  if (!stamp.fetchedAt || !stamp.staleAt) {
    throw new Error("Cached response requires complete timestamps");
  }
  const uniqueJobs = [...new Map(refreshJobs.map((job) => [job.id, job])).values()];
  return {
    data,
    meta: {
      cache: uniqueJobs.length > 0 ? "stale" : "hit",
      fetchedAt: stamp.fetchedAt.toISOString(),
      staleAt: stamp.staleAt.toISOString(),
      refreshJobs: uniqueJobs.map(toJobSummary),
      ...(enrichment ? { enrichment } : {}),
    },
  };
}

function accepted(jobs: readonly StoredJobRecord[]): ApiAcceptedResponse {
  const unique = [...new Map(jobs.map((job) => [job.id, job])).values()];
  return {
    data: null,
    meta: { cache: "miss", jobs: unique.map(toJobSummary) },
  };
}

function failedJobResponse(job: StoredJobRecord): ApiErrorResponse {
  if (job.errorCode === "not_found") {
    return {
      error: {
        code: "resource_not_found",
        message: "The requested Letterboxd resource was not found",
      },
    };
  }
  if (job.errorCode === "rate_limited") {
    return {
      error: {
        code: "rate_limited",
        message: "The upstream service rate limited the request",
      },
    };
  }
  if (job.errorCode === "upstream_unavailable" || job.errorCode === "timeout") {
    return {
      error: {
        code: "upstream_unavailable",
        message: "The upstream service is temporarily unavailable",
      },
    };
  }
  return {
    error: {
      code: "internal_error",
      message: "The background job could not be started",
    },
  };
}

export function toJobSummary(job: StoredJobRecord): ApiJobSummary {
  return {
    id: job.id,
    type: job.type,
    resourceKey: job.resourceKey,
    status: job.status,
    attempts: job.attempts,
    statusUrl: `/api/v1/jobs/${job.id}`,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.errorCode
      ? { code: job.errorCode, message: sanitizedJobMessage(job.errorCode) }
      : null,
  };
}

function sanitizedJobMessage(code: JobFailureCode): string {
  const messages: Record<JobFailureCode, string> = {
    invalid_input: "The job input was invalid",
    not_found: "The requested resource was not found",
    upstream_unavailable: "The upstream service was unavailable",
    rate_limited: "The upstream service rate limited the request",
    timeout: "The upstream request timed out",
    parse_error: "The upstream response could not be processed",
    attempts_exhausted: "The job exhausted its retry attempts",
    unknown: "The job failed",
  };
  return messages[code];
}

function toProfileSummary(user: UserRecord): ProfileSummaryDto {
  return {
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
}

function toListItem(
  item: { position: number; movie: MovieRecord },
  includeMetadata: boolean
): ListItemDto {
  return {
    position: item.position,
    movie: toMovieDto(item.movie, includeMetadata),
  };
}

function toWatchedListItem(
  item: WatchedListItemRecord,
  includeMetadata: boolean
): WatchedListItemDto {
  return {
    ...toListItem(item, includeMetadata),
    userRating: item.userRating,
  };
}

function toMovieDto(movie: MovieRecord, includeMetadata: boolean): MovieDto {
  return {
    letterboxdSlug: movie.letterboxdSlug,
    title: movie.title,
    year: movie.year,
    letterboxdFilmId: movie.letterboxdFilmId,
    tmdbId: movie.tmdbId,
    letterboxdPoster: movie.letterboxdPoster,
    letterboxdRating: movie.letterboxdRating,
    ...(includeMetadata
      ? { metadata: movie.metadata ? toMetadataDto(movie.metadata) : null }
      : {}),
  };
}

function toFullMovieDto(movie: MovieRecord): FullMovieDto {
  return {
    ...toMovieDto(movie, false),
    metadata: movie.metadata ? toMetadataDto(movie.metadata) : null,
  };
}

function toMetadataDto(
  metadata: NonNullable<MovieRecord["metadata"]>
): MovieMetadataDto {
  if (!metadata.fetchedAt || !metadata.staleAt) {
    throw new Error("Stored movie metadata requires complete timestamps");
  }
  return {
    runtimeMinutes: metadata.runtimeMinutes,
    overview: metadata.overview,
    tmdbTitle: metadata.tmdbTitle,
    originalTitle: metadata.originalTitle,
    originalLanguage: metadata.originalLanguage,
    tmdbReleaseDate: metadata.tmdbReleaseDate?.toISOString().slice(0, 10) ?? null,
    tmdbVoteAverage: metadata.tmdbVoteAverage,
    tmdbPosterPath: metadata.tmdbPosterPath,
    tmdbBackdropPath: metadata.tmdbBackdropPath,
    tmdbFetchedAt: metadata.fetchedAt.toISOString(),
    tmdbStaleAt: metadata.staleAt.toISOString(),
    genres: metadata.genres,
  };
}

function movieEnrichmentMeta(
  movies: readonly MovieRecord[]
): MovieEnrichmentMeta {
  const pendingSlugs = movies
    .filter((movie) => movie.resolutionStatus === "pending")
    .map((movie) => movie.letterboxdSlug);
  const failedSlugs = movies
    .filter((movie) => movie.resolutionStatus === "failed")
    .map((movie) => movie.letterboxdSlug);
  return {
    complete: pendingSlugs.length === 0 && failedSlugs.length === 0,
    pendingSlugs,
    failedSlugs,
  };
}

function aggregateStamps(stamps: readonly CacheStamp[]): CacheStamp {
  if (stamps.length === 0 || stamps.some((stamp) => !stamp.fetchedAt || !stamp.staleAt)) {
    return { fetchedAt: null, staleAt: null };
  }
  return {
    fetchedAt: new Date(Math.min(...stamps.map((stamp) => stamp.fetchedAt!.getTime()))),
    staleAt: new Date(Math.min(...stamps.map((stamp) => stamp.staleAt!.getTime()))),
  };
}

function toOverlapFilm(
  group: OverlapGroupRecord,
  partySize: number,
  includeMetadata: boolean
): OverlapFilmDto {
  return {
    ...toMovieDto(group.movie, includeMetadata),
    presentFor: group.presentFor,
    overlapCount: group.presentFor.length,
    partySize,
  };
}

function toWatchedOverlapFilm(
  group: WatchedOverlapGroupRecord,
  partySize: number,
  includeMetadata: boolean
): WatchedOverlapFilmDto {
  return {
    ...toMovieDto(group.movie, includeMetadata),
    watchedBy: group.watchedBy,
    watchedCount: group.watchedBy.length,
    partySize,
  };
}
