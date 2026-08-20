import * as cheerio from "cheerio";
import { LETTERBOXD_BASE } from "./constants";
import { fetchHtmlPage, type FetchedHtmlPage } from "./fetchHtml";
import { ProviderNotFoundError } from "./providerErrors";

export interface ResolvedLetterboxdMovie {
  letterboxdSlug: string;
  html: string;
}

export async function resolveLetterboxdMovieByTmdbId(
  tmdbId: number,
  fetchPage: (url: string) => Promise<FetchedHtmlPage> = fetchHtmlPage
): Promise<ResolvedLetterboxdMovie> {
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
    throw new TypeError("TMDB movie ID must be a positive integer");
  }

  const tmdbUrl = `${LETTERBOXD_BASE}/tmdb/${tmdbId}/`;
  const page = await fetchPage(tmdbUrl);
  const slug =
    filmSlugFromUrl(page.url) ?? filmSlugFromCanonicalHtml(page.html);

  if (!slug) {
    throw new ProviderNotFoundError(
      `No Letterboxd film is mapped to TMDB movie ${tmdbId}`,
      { status: 404 }
    );
  }

  return { letterboxdSlug: slug, html: page.html };
}

function filmSlugFromCanonicalHtml(html: string): string | null {
  const canonicalUrl = cheerio
    .load(html)('link[rel="canonical"]')
    .first()
    .attr("href");
  return canonicalUrl ? filmSlugFromUrl(canonicalUrl) : null;
}

function filmSlugFromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value, LETTERBOXD_BASE);
  } catch {
    return null;
  }

  if (url.hostname !== "letterboxd.com" && url.hostname !== "www.letterboxd.com") {
    return null;
  }

  const match = url.pathname.match(/^\/film\/([a-z0-9_-]+)\/?$/i);
  return match?.[1]?.toLowerCase() ?? null;
}
