export const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p" as const;
export const DEFAULT_TMDB_POSTER_SIZE = "w500" as const;
export const DEFAULT_POSTER_PLACEHOLDER_URL = "/file.svg" as const;

export const POSTER_SOURCES = ["tmdb", "letterboxd", "placeholder"] as const;
export type PosterSource = (typeof POSTER_SOURCES)[number];

export interface PosterSelectionInput {
  /** A complete TMDB image URL, when the provider has already built one. */
  tmdbPosterUrl?: string | null;
  /** A TMDB path such as `/abc123.jpg`, used when no full URL is supplied. */
  tmdbPosterPath?: string | null;
  /** Letterboxd candidates in scraper preference order, primary first. */
  letterboxdPosterUrls?: readonly string[] | null;
  placeholderUrl?: string;
}

export interface PosterSelection {
  posterUrl: string;
  posterSource: PosterSource;
  /** Ordered browser retry candidates; excludes posterUrl itself. */
  posterFallbackUrls: string[];
}

export function buildTmdbPosterUrl(
  posterPath: string,
  size = DEFAULT_TMDB_POSTER_SIZE
): string {
  const normalizedPath = posterPath.trim();
  if (!normalizedPath) {
    throw new TypeError("TMDB poster path must not be empty");
  }

  const path = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
}

/**
 * Selects a poster using the frozen precedence:
 * TMDB, first Letterboxd candidate, remaining Letterboxd candidates, placeholder.
 */
export function selectPoster(input: PosterSelectionInput): PosterSelection {
  const placeholderUrl =
    cleanUrl(input.placeholderUrl) ?? DEFAULT_POSTER_PLACEHOLDER_URL;
  const tmdbPosterPath = cleanUrl(input.tmdbPosterPath);
  const tmdbUrl =
    cleanUrl(input.tmdbPosterUrl) ??
    (tmdbPosterPath ? buildTmdbPosterUrl(tmdbPosterPath) : undefined);
  const letterboxdUrls = uniqueUrls(input.letterboxdPosterUrls ?? []);

  const orderedCandidates = uniqueUrls([
    ...(tmdbUrl ? [tmdbUrl] : []),
    ...letterboxdUrls,
    placeholderUrl,
  ]);
  const posterUrl = orderedCandidates[0] ?? placeholderUrl;

  return {
    posterUrl,
    posterSource: tmdbUrl
      ? "tmdb"
      : letterboxdUrls.length > 0
        ? "letterboxd"
        : "placeholder",
    posterFallbackUrls: orderedCandidates.slice(1),
  };
}

function uniqueUrls(urls: readonly (string | null | undefined)[]): string[] {
  return [...new Set(urls.map(cleanUrl).filter(isDefined))];
}

function cleanUrl(url: string | null | undefined): string | undefined {
  const trimmed = url?.trim();
  return trimmed || undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
