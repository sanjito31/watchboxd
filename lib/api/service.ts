import type {
  ApiAcceptedResponse,
  ApiDataResponse,
  ApiErrorResponse,
  ApiJobResponse,
  ApiJobSummary,
  MovieDto,
  MovieSummaryDto,
  NetworkDto,
  OverlapDto,
  OverlapFilmDto,
  PaginationMeta,
  ProfileDto,
  ProfileSummaryDto,
  WatchedDto,
  WatchlistDto,
} from "@/lib/api/contracts";
import { classifyFreshness } from "@/lib/cache/policy";
import {
  type JobFailureCode,
  type JobType,
} from "@/lib/jobs/contracts";
import {
  DEFAULT_POSTER_PLACEHOLDER_URL,
  selectPoster,
  TMDB_IMAGE_BASE_URL,
} from "@/lib/movies/posters";
import type {
  ApiRepository,
  CacheStamp,
  JobGateway,
  ListItemRecord,
  MovieRecord,
  StoredJobRecord,
  UserListRecord,
  UserRecord,
} from "@/lib/api/types";

type ResourceResult<T> =
  | ApiDataResponse<T>
  | ApiAcceptedResponse
  | ApiErrorResponse;

const LETTERBOXD_BASE_URL = "https://letterboxd.com";
const TMDB_BACKDROP_SIZE = "w1280";

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

    const data: ProfileDto = {
      ...toProfileSummary(user),
      letterboxdUrl: `${LETTERBOXD_BASE_URL}/${user.username}/`,
    };
    return this.cachedResource(data, user.profile, "profile", username);
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

    const pagination = paginate(list.items, page, pageSize);
    const data: WatchlistDto = {
      user: toProfileSummary(list.user),
      items: pagination.items.map(toWatchlistItem),
      filmCount: list.items.length,
      pagination: pagination.meta,
    };
    return this.cachedResource(
      data,
      list.user.watchlist,
      "watchlist",
      username
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

    const pagination = paginate(list.items, page, pageSize);
    const data: WatchedDto = {
      user: toProfileSummary(list.user),
      items: pagination.items.map(toWatchlistItem),
      filmCount: list.items.length,
      pagination: pagination.meta,
    };
    return this.cachedResource(data, list.user.watched, "watched", username);
  }

  async getNetwork(username: string): Promise<ResourceResult<NetworkDto>> {
    const network = await this.repository.getNetwork(username);
    const profileMissing =
      !network ||
      classifyFreshness(network.user.profile, this.now()) === "missing";
    const networkMissing =
      !network ||
      classifyFreshness(network.user.network, this.now()) === "missing";

    if (profileMissing || networkMissing) {
      const jobs = await Promise.all([
        ...(profileMissing
          ? [this.jobs.ensureJob("profile", username)]
          : []),
        ...(networkMissing
          ? [this.jobs.ensureJob("network", username)]
          : []),
      ]);
      const failed = jobs.find((job) => job.status === "failed");
      if (failed) return failedJobResponse(failed);
      return accepted(jobs);
    }
    return this.cachedResource(
      network.data,
      network.user.network,
      "network",
      username
    );
  }

  async getMovie(slug: string): Promise<ResourceResult<MovieDto>> {
    const movie = await this.repository.getMovie(slug);
    if (!movie) {
      return this.missOrNotFound("movie", slug);
    }
    const stamp = movieCacheStamp(movie);
    if (classifyFreshness(stamp, this.now()) === "missing") {
      return this.missOrNotFound("movie", slug);
    }
    return this.cachedResource(toMovieDto(movie), stamp, "movie", slug);
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
      return (
        !list ||
        classifyFreshness(list.user.watchlist, this.now()) === "missing"
      );
    });

    if (missing.length > 0) {
      const jobs = await Promise.all(
        missing.map((username) => this.jobs.ensureJob("watchlist", username))
      );
      const failed = jobs.find((job) => job.status === "failed");
      if (failed) return failedJobResponse(failed);
      return accepted(jobs);
    }

    const orderedLists = usernames.map(
      (username) => byUsername.get(username) as UserListRecord
    );
    const profiles = orderedLists.map((list) => toProfileSummary(list.user));
    const groups = groupOverlap(orderedLists);
    const pagination = paginate(groups, page, pageSize);

    const enrichmentJobs = await Promise.all(
      pagination.items
        .filter(
          (film) =>
            classifyFreshness(movieCacheStampFromDtoSource(film), this.now()) ===
            "missing"
        )
        .map((film) =>
          this.jobs.ensureJob("movie", film.movie.letterboxdSlug)
        )
    );
    const activeEnrichmentJobs = enrichmentJobs.filter(
      (job) => job.status === "queued" || job.status === "running"
    );
    if (activeEnrichmentJobs.length > 0) {
      return accepted(activeEnrichmentJobs);
    }

    const data: OverlapDto = {
      users: profiles,
      films: pagination.items.map((group) =>
        toOverlapFilm(group.movie, group.presentFor, profiles.length)
      ),
      pagination: pagination.meta,
    };

    const stamp = aggregateStamps(
      orderedLists.map((list) => list.user.watchlist)
    );
    const staleUsers = orderedLists.filter(
      (list) => classifyFreshness(list.user.watchlist, this.now()) === "stale"
    );
    if (staleUsers.length === 0) {
      return cached(data, stamp, "hit");
    }

    const refreshJobs = await Promise.all(
      staleUsers.map((list) =>
        this.jobs.ensureJob("watchlist", list.user.username)
      )
    );
    return cached(data, stamp, "stale", toJobSummary(refreshJobs[0]!));
  }

  async getJob(id: string): Promise<ApiJobResponse | ApiErrorResponse> {
    const job = await this.jobs.getJob(id);
    if (!job) {
      return {
        error: {
          code: "job_not_found",
          message: "Job not found",
        },
      };
    }
    return { data: toJobSummary(job) };
  }

  private async cachedResource<T>(
    data: T,
    stamp: CacheStamp,
    type: JobType,
    identifier: string
  ): Promise<ApiDataResponse<T>> {
    if (classifyFreshness(stamp, this.now()) === "fresh") {
      return cached(data, stamp, "hit");
    }
    const refreshJob = await this.jobs.ensureJob(type, identifier);
    return cached(data, stamp, "stale", toJobSummary(refreshJob));
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
  cache: "hit" | "stale",
  refreshJob?: ApiJobSummary
): ApiDataResponse<T> {
  if (!stamp.fetchedAt || !stamp.staleAt) {
    throw new Error("Cached response requires complete timestamps");
  }
  return {
    data,
    meta: {
      cache,
      fetchedAt: stamp.fetchedAt.toISOString(),
      staleAt: stamp.staleAt.toISOString(),
      ...(refreshJob ? { refreshJob } : {}),
    },
  };
}

function accepted(jobs: readonly StoredJobRecord[]): ApiAcceptedResponse {
  const unique = [...new Map(jobs.map((job) => [job.id, job])).values()];
  return {
    data: null,
    meta: {
      cache: "miss",
      jobs: unique.map(toJobSummary),
    },
  };
}

function resourceNotFound(): ApiErrorResponse {
  return {
    error: {
      code: "resource_not_found",
      message: "The requested Letterboxd resource was not found",
    },
  };
}

function failedJobResponse(job: StoredJobRecord): ApiErrorResponse {
  if (job.errorCode === "not_found") return resourceNotFound();
  if (job.errorCode === "rate_limited") {
    return {
      error: {
        code: "rate_limited",
        message: "The upstream service rate limited the request",
      },
    };
  }
  if (
    job.errorCode === "upstream_unavailable" ||
    job.errorCode === "timeout"
  ) {
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
      ? {
          code: job.errorCode,
          message: sanitizedJobMessage(job.errorCode),
        }
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

function toWatchlistItem(item: ListItemRecord) {
  return {
    position: item.position,
    sourceTitle: item.sourceTitle,
    sourceSlug: item.sourceSlug,
    sourceYear: item.sourceYear,
    resolutionStatus: item.resolutionStatus,
    movie: toMovieSummary(item.movie),
  };
}

function toMovieSummary(movie: MovieRecord): MovieSummaryDto {
  return {
    ...selectPoster({
      tmdbPosterPath: movie.tmdbPosterPath,
      letterboxdPosterUrls: movie.letterboxdPosterUrls,
      placeholderUrl: DEFAULT_POSTER_PLACEHOLDER_URL,
    }),
    letterboxdFilmId: movie.letterboxdFilmId,
    tmdbId: movie.tmdbId,
    letterboxdSlug: movie.letterboxdSlug,
    letterboxdUrl: `${LETTERBOXD_BASE_URL}/film/${movie.letterboxdSlug}/`,
    title: movie.title,
    year: movie.year,
    resolutionStatus: movie.resolutionStatus,
    letterboxdRating: movie.letterboxdRating,
  };
}

function toMovieDto(movie: MovieRecord): MovieDto {
  return {
    ...toMovieSummary(movie),
    originalTitle: movie.tmdbOriginalTitle,
    overview: movie.tmdbOverview,
    releaseDate: movie.tmdbReleaseDate?.toISOString().slice(0, 10) ?? null,
    runtimeMinutes: movie.tmdbRuntimeMinutes,
    genres: movie.tmdbGenres,
    tmdbVoteAverage: movie.tmdbVoteAverage,
    backdropUrl: movie.tmdbBackdropPath
      ? `${TMDB_IMAGE_BASE_URL}/${TMDB_BACKDROP_SIZE}${
          movie.tmdbBackdropPath.startsWith("/") ? "" : "/"
        }${movie.tmdbBackdropPath}`
      : null,
  };
}

function movieCacheStamp(movie: MovieRecord): CacheStamp {
  return aggregateStamps([movie.tmdb, movie.letterboxd]);
}

function movieCacheStampFromDtoSource(group: {
  movie: MovieRecord;
}): CacheStamp {
  return movieCacheStamp(group.movie);
}

function aggregateStamps(stamps: readonly CacheStamp[]): CacheStamp {
  if (
    stamps.length === 0 ||
    stamps.some((stamp) => !stamp.fetchedAt || !stamp.staleAt)
  ) {
    return { fetchedAt: null, staleAt: null };
  }

  return {
    fetchedAt: new Date(
      Math.min(...stamps.map((stamp) => stamp.fetchedAt!.getTime()))
    ),
    staleAt: new Date(
      Math.min(...stamps.map((stamp) => stamp.staleAt!.getTime()))
    ),
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
        a.movie.title.localeCompare(b.movie.title, "en", {
          sensitivity: "base",
        })
      );
    });
}

function toOverlapFilm(
  movie: MovieRecord,
  presentFor: ProfileSummaryDto[],
  partySize: number
): OverlapFilmDto {
  return {
    ...toMovieSummary(movie),
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
