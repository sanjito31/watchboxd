import type {
  ApiAcceptedResponse,
  ApiDataResponse,
  ApiErrorResponse,
  ApiJobResponse,
  ApiJobSummary,
  ListItemDto,
  MovieEnrichmentMeta,
  MovieDto,
  NetworkDto,
  OverlapDto,
  OverlapFilmDto,
  PaginationMeta,
  ProfileDto,
  ProfileSummaryDto,
  WatchedDto,
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
  ListItemRecord,
  MovieRecord,
  StoredJobRecord,
  UserListRecord,
  UserRecord,
  WatchedListItemRecord,
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
    page: number,
    pageSize: number
  ): Promise<ResourceResult<WatchlistDto>> {
    const list = await this.repository.getWatchlist(username);
    if (!list || classifyFreshness(list.user.watchlist, this.now()) === "missing") {
      return this.missOrNotFound("watchlist", username);
    }
    return this.listResponse(
      list,
      "watchlist",
      username,
      page,
      pageSize,
      toListItem
    );
  }

  async getWatched(
    username: string,
    page: number,
    pageSize: number
  ): Promise<ResourceResult<WatchedDto>> {
    const list = await this.repository.getWatched(username);
    if (!list || classifyFreshness(list.user.watched, this.now()) === "missing") {
      return this.missOrNotFound("watched", username);
    }
    return this.listResponse(
      list,
      "watched",
      username,
      page,
      pageSize,
      toWatchedListItem
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

  async getMovie(tmdbId: number): Promise<ResourceResult<MovieDto>> {
    const identifier = buildTmdbMovieJobIdentifier(tmdbId);
    return this.movieResponse(
      await this.repository.getMovieByTmdbId(tmdbId),
      identifier
    );
  }

  async getMovieByLetterboxdSlug(slug: string): Promise<ResourceResult<MovieDto>> {
    return this.movieResponse(
      await this.repository.getMovieByLetterboxdSlug(slug),
      slug
    );
  }

  async getOverlap(
    usernames: readonly string[],
    page: number,
    pageSize: number
  ): Promise<ResourceResult<OverlapDto>> {
    const watchlists = await this.repository.getWatchlists(usernames);
    const byUsername = new Map(
      watchlists.map((watchlist) => [watchlist.user.username, watchlist])
    );
    const missing = usernames.filter((username) => {
      const list = byUsername.get(username);
      return !list || classifyFreshness(list.user.watchlist, this.now()) === "missing";
    });
    if (missing.length > 0) {
      const jobs = await Promise.all(
        missing.map((username) => this.jobs.ensureJob("watchlist", username))
      );
      const failed = jobs.find((job) => job.status === "failed");
      return failed ? failedJobResponse(failed) : accepted(jobs);
    }

    const orderedLists = usernames.map(
      (username) => byUsername.get(username) as UserListRecord
    );
    const profiles = orderedLists.map((list) => toProfileSummary(list.user));
    const pagination = paginate(groupOverlap(orderedLists), page, pageSize);
    const pageMovies = pagination.items.map((group) => group.movie);
    const pendingResult = await this.pendingMovies(pageMovies);
    if (pendingResult) return pendingResult;

    const data: OverlapDto = {
      users: profiles,
      films: pagination.items.map((group) =>
        toOverlapFilm(group.movie, group.presentFor, profiles.length)
      ),
      pagination: pagination.meta,
    };
    const listStamps = orderedLists.map((list) => list.user.watchlist);
    const stamp = aggregateStamps([...listStamps, ...pageMovies.map(movieStamp)]);
    const refreshJobs = await this.refreshStaleResources([
      ...orderedLists.map((list) => ({
        stamp: list.user.watchlist,
        type: "watchlist" as const,
        identifier: list.user.username,
      })),
      ...pageMovies.map((movie) => ({
        stamp: movie.letterboxd,
        type: "movie" as const,
        identifier: movie.letterboxdSlug,
      })),
    ]);
    return cached(data, stamp, refreshJobs);
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
    page: number,
    pageSize: number,
    mapItem: (item: TRecord) => TDto
  ): Promise<
    ResourceResult<{
      user: ProfileSummaryDto;
      items: TDto[];
      filmCount: number;
      pagination: PaginationMeta;
    }>
  > {
    const pagination = paginate(list.items, page, pageSize);
    const pageMovies = pagination.items.map((item) => item.movie);

    const listStamp =
      kind === "watchlist" ? list.user.watchlist : list.user.watched;
    const data = {
      user: toProfileSummary(list.user),
      items: pagination.items.map(mapItem),
      filmCount: list.items.length,
      pagination: pagination.meta,
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
  ): Promise<ResourceResult<MovieDto>> {
    if (!movie || movie.resolutionStatus !== "resolved") {
      return this.missOrNotFound("movie", identifier);
    }
    return this.cachedResource(
      toMovieDto(movie),
      movie.letterboxd,
      "movie",
      movie.letterboxdSlug
    );
  }

  private async pendingMovies(
    movies: readonly MovieRecord[]
  ): Promise<ApiAcceptedResponse | ApiErrorResponse | null> {
    const pending = movies.filter((movie) => movie.resolutionStatus === "pending");
    if (pending.length === 0) return null;
    const jobs = await Promise.all(
      pending.map((movie) =>
        this.jobs.ensureJob("movie", movie.letterboxdSlug)
      )
    );
    const failed = jobs.find((job) => job.status === "failed");
    return failed ? failedJobResponse(failed) : accepted(jobs);
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

function toListItem(item: { position: number; movie: MovieRecord }): ListItemDto {
  return { position: item.position, movie: toMovieDto(item.movie) };
}

function toWatchedListItem(
  item: WatchedListItemRecord
): WatchedListItemDto {
  return { ...toListItem(item), userRating: item.userRating };
}

function toMovieDto(movie: MovieRecord): MovieDto {
  return {
    letterboxdSlug: movie.letterboxdSlug,
    title: movie.title,
    year: movie.year,
    letterboxdFilmId: movie.letterboxdFilmId,
    tmdbId: movie.tmdbId,
    letterboxdPoster: movie.letterboxdPoster,
    letterboxdRating: movie.letterboxdRating,
  };
}

function movieStamp(movie: MovieRecord): CacheStamp {
  return movie.letterboxd;
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

function groupOverlap(lists: readonly UserListRecord[]) {
  const groups = new Map<
    string,
    {
      movie: MovieRecord;
      presentFor: ProfileSummaryDto[];
      usernames: Set<string>;
    }
  >();
  for (const list of lists) {
    const profile = toProfileSummary(list.user);
    for (const item of list.items) {
      if (item.movie.resolutionStatus === "failed") continue;
      const key =
        item.movie.tmdbId !== null
          ? `tmdb:${item.movie.tmdbId}`
          : `letterboxd:${item.movie.letterboxdSlug}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          movie: item.movie,
          presentFor: [profile],
          usernames: new Set([profile.username]),
        });
      } else if (!existing.usernames.has(profile.username)) {
        existing.usernames.add(profile.username);
        existing.presentFor.push(profile);
      }
    }
  }
  return [...groups.values()]
    .filter((group) => group.presentFor.length >= 2)
    .sort((a, b) => {
      const countDifference = b.presentFor.length - a.presentFor.length;
      return (
        countDifference ||
        a.movie.title.localeCompare(b.movie.title, "en", { sensitivity: "base" })
      );
    });
}

function toOverlapFilm(
  movie: MovieRecord,
  presentFor: ProfileSummaryDto[],
  partySize: number
): OverlapFilmDto {
  return {
    ...toMovieDto(movie),
    presentFor,
    overlapCount: presentFor.length,
    partySize,
  };
}

function paginate<T>(
  values: readonly T[],
  requestedPage: number,
  pageSize: number
): { items: T[]; meta: PaginationMeta } {
  const total = values.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  return {
    items: values.slice(start, start + pageSize),
    meta: { page, pageSize, total, totalPages },
  };
}
