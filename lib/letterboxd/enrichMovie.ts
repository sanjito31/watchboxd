import type { MovieDto, MovieResolutionStatus } from "@/lib/api/contracts";
import { computeStaleAt } from "@/lib/cache/policy";
import {
  buildTmdbPosterUrl,
  selectPoster,
} from "@/lib/movies/posters";
import { TmdbClient } from "@/lib/tmdb/client";
import { buildTmdbBackdropUrl } from "@/lib/tmdb/images";
import { resolveMovieByTitleAndYear } from "@/lib/tmdb/resolveMovie";
import type {
  TmdbMovieDetails,
  TmdbMovieProvider,
} from "@/lib/tmdb/types";
import { LETTERBOXD_BASE } from "./constants";
import { fetchHtml } from "./fetchHtml";
import { parseLetterboxdFilmPage } from "./parseFilmPage";
import { isProviderNotFoundError } from "./providerErrors";

export interface ProviderSourceTimestamp {
  fetchedAt: Date;
  staleAt: Date;
}

export interface MovieEnrichmentInput {
  letterboxdSlug: string;
  letterboxdFilmId?: number | null;
  sourceTitle?: string | null;
  sourceYear?: number | null;
  /** Known TMDB ID from persisted enrichment or another trusted TMDB source. */
  directTmdbId?: number | null;
  /** Alias accepted for direct use with a film-grid item. */
  tmdbId?: number | null;
  letterboxdPosterUrls?: readonly string[];
}

export interface MovieEnrichmentOptions {
  tmdb?: TmdbMovieProvider;
  fetchLetterboxdHtml?: (url: string) => Promise<string>;
  now?: () => Date;
}

/**
 * Flat provider output suitable for both the frozen Movie DTO and Movie
 * persistence columns.
 */
export interface MovieEnrichmentResult extends MovieDto {
  tmdbTitle: string | null;
  tmdbPosterPath: string | null;
  tmdbBackdropPath: string | null;
  letterboxdPosterUrls: string[];
  tmdbFetchedAt: Date | null;
  tmdbStaleAt: Date | null;
  letterboxdFetchedAt: Date;
  letterboxdStaleAt: Date;
  sourceTimestamps: {
    tmdb: ProviderSourceTimestamp | null;
    letterboxd: ProviderSourceTimestamp;
  };
}

export async function enrichMovie(
  input: MovieEnrichmentInput,
  options: MovieEnrichmentOptions = {}
): Promise<MovieEnrichmentResult> {
  const slug = normalizeSlug(input.letterboxdSlug);
  const now = options.now ?? (() => new Date());
  const filmUrl = `${LETTERBOXD_BASE}/film/${slug}/`;
  const html = await (options.fetchLetterboxdHtml ?? fetchHtml)(filmUrl);
  const letterboxdFetchedAt = now();
  const filmPage = parseLetterboxdFilmPage(html);
  const letterboxdTimestamps = {
    fetchedAt: letterboxdFetchedAt,
    staleAt: computeStaleAt("letterboxdRating", letterboxdFetchedAt),
  };

  const title =
    cleanString(input.sourceTitle) ?? filmPage.title ?? slugToTitle(slug);
  const year = input.sourceYear ?? filmPage.year;
  const letterboxdPosterUrls = uniqueUrls([
    ...(input.letterboxdPosterUrls ?? []),
    ...filmPage.posterUrls,
  ]);

  const letterboxdFilmId =
    input.letterboxdFilmId ?? filmPage.letterboxdFilmId ?? null;
  const directTmdbId =
    input.directTmdbId ?? input.tmdbId ?? filmPage.tmdbId ?? null;
  if (
    directTmdbId !== null &&
    (!Number.isSafeInteger(directTmdbId) || directTmdbId <= 0)
  ) {
    throw new TypeError("Direct TMDB movie ID must be a positive integer");
  }

  let resolutionStatus: MovieResolutionStatus =
    directTmdbId === null ? "pending" : "resolved";
  let tmdbId = directTmdbId;
  let details: TmdbMovieDetails | null = null;
  let tmdbTimestamps: ProviderSourceTimestamp | null = null;
  const shouldResolve = directTmdbId !== null || year !== null;

  if (shouldResolve) {
    const tmdb = options.tmdb ?? new TmdbClient();
    try {
      if (directTmdbId === null) {
        const resolution = await resolveMovieByTitleAndYear(tmdb, title, year);
        resolutionStatus = resolution.status;
        tmdbId = resolution.tmdbId;
      }

      if (tmdbId !== null) {
        details = await tmdb.getMovieDetails(tmdbId);
        resolutionStatus = "resolved";
      }
    } catch (error) {
      if (!isProviderNotFoundError(error)) throw error;
      tmdbId = null;
      details = null;
      resolutionStatus = "unresolved";
    }

  } else {
    resolutionStatus = "unresolved";
  }

  // Cache both successful metadata and a completed no-match/no-year attempt.
  // Without this stamp, unresolved films would enqueue another movie job on
  // every API request even though the provider work already completed.
  const tmdbFetchedAt = now();
  tmdbTimestamps = {
    fetchedAt: tmdbFetchedAt,
    staleAt: computeStaleAt("tmdbMetadata", tmdbFetchedAt),
  };

  const tmdbPosterPath = cleanString(details?.poster_path);
  const tmdbBackdropPath = cleanString(details?.backdrop_path);
  const poster = selectPoster({
    tmdbPosterUrl: tmdbPosterPath
      ? buildTmdbPosterUrl(tmdbPosterPath)
      : null,
    letterboxdPosterUrls,
  });

  return {
    letterboxdFilmId,
    tmdbId,
    letterboxdSlug: slug,
    letterboxdUrl: filmUrl,
    title,
    year,
    resolutionStatus,
    letterboxdRating: filmPage.weightedAverage,
    ...poster,
    originalTitle: cleanString(details?.original_title),
    overview: cleanString(details?.overview),
    releaseDate: validReleaseDate(details?.release_date),
    runtimeMinutes:
      typeof details?.runtime === "number" && details.runtime >= 0
        ? details.runtime
        : null,
    genres: uniqueStrings(details?.genres.map((genre) => genre.name) ?? []),
    tmdbVoteAverage: finiteNumber(details?.vote_average),
    backdropUrl: tmdbBackdropPath
      ? buildTmdbBackdropUrl(tmdbBackdropPath)
      : null,
    tmdbTitle: cleanString(details?.title),
    tmdbPosterPath,
    tmdbBackdropPath,
    letterboxdPosterUrls,
    tmdbFetchedAt: tmdbTimestamps?.fetchedAt ?? null,
    tmdbStaleAt: tmdbTimestamps?.staleAt ?? null,
    letterboxdFetchedAt: letterboxdTimestamps.fetchedAt,
    letterboxdStaleAt: letterboxdTimestamps.staleAt,
    sourceTimestamps: {
      tmdb: tmdbTimestamps,
      letterboxd: letterboxdTimestamps,
    },
  };
}

function normalizeSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    throw new TypeError("Invalid Letterboxd film slug");
  }
  return normalized;
}

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function cleanString(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function validReleaseDate(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function finiteNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function uniqueUrls(urls: readonly string[]): string[] {
  return uniqueStrings(urls);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
