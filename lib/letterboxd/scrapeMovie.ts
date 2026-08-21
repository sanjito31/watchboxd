import { computeStaleAt } from "@/lib/cache/policy";
import { LETTERBOXD_BASE } from "./constants";
import { fetchHtmlPage, type FetchedHtmlPage } from "./fetchHtml";
import { parseLetterboxdFilmPage } from "./parseFilmPage";
import {
  filmSlugFromCanonicalHtml,
  filmSlugFromUrl,
} from "./resolveTmdbMovie";

export interface MovieScrapeInput {
  letterboxdSlug: string;
  fallbackTitle?: string | null;
  fallbackYear?: number | null;
  fallbackPoster?: string | null;
  knownTmdbId?: number | null;
}

export interface MovieScrapeResult {
  requestedSlug: string;
  letterboxdSlug: string;
  title: string;
  year: number | null;
  letterboxdFilmId: number | null;
  tmdbId: number | null;
  letterboxdPoster: string | null;
  letterboxdRating: number | null;
  letterboxdFetchedAt: Date;
  letterboxdStaleAt: Date;
}

export interface MovieScrapeOptions {
  fetchPage?: (url: string) => Promise<FetchedHtmlPage>;
  now?: () => Date;
}

export async function scrapeLetterboxdMovie(
  input: MovieScrapeInput,
  options: MovieScrapeOptions = {}
): Promise<MovieScrapeResult> {
  const requestedSlug = normalizeFilmSlug(input.letterboxdSlug);
  const page = await (options.fetchPage ?? fetchHtmlPage)(
    `${LETTERBOXD_BASE}/film/${requestedSlug}/`
  );
  return movieScrapeResultFromPage(input, page, options.now);
}

export function movieScrapeResultFromPage(
  input: MovieScrapeInput,
  page: FetchedHtmlPage,
  now: (() => Date) = () => new Date()
): MovieScrapeResult {
  const requestedSlug = normalizeFilmSlug(input.letterboxdSlug);
  const letterboxdSlug =
    filmSlugFromUrl(page.url) ??
    filmSlugFromCanonicalHtml(page.html) ??
    requestedSlug;
  const parsed = parseLetterboxdFilmPage(page.html);
  const fetchedAt = now();

  return {
    requestedSlug,
    letterboxdSlug,
    title:
      cleanString(parsed.title) ??
      cleanString(input.fallbackTitle) ??
      slugToTitle(letterboxdSlug),
    year: parsed.year ?? input.fallbackYear ?? null,
    letterboxdFilmId: parsed.letterboxdFilmId,
    // Letterboxd's outbound link is authoritative. The known ID is only a
    // compatibility fallback for /tmdb/{id}/ pages that omit the outbound link.
    tmdbId: parsed.tmdbId ?? validPositiveInteger(input.knownTmdbId),
    letterboxdPoster:
      parsed.posterUrls.find((url) => cleanString(url) !== null) ??
      cleanString(input.fallbackPoster),
    letterboxdRating: parsed.weightedAverage,
    letterboxdFetchedAt: fetchedAt,
    letterboxdStaleAt: computeStaleAt("movie", fetchedAt),
  };
}

export function normalizeFilmSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    throw new TypeError("Invalid Letterboxd film slug");
  }
  return normalized;
}

function cleanString(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function validPositiveInteger(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : null;
}

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
