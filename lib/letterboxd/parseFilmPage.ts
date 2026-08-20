import * as cheerio from "cheerio";
import { extractLetterboxdFilmIdFromResolvablePosterPath } from "./buildPosterUrl";
import type { LetterboxdFilmPageData } from "./types";

export function parseLetterboxdFilmPage(
  html: string
): LetterboxdFilmPageData {
  const $ = cheerio.load(html);
  let title: string | null = null;
  let year: number | null = null;
  const letterboxdFilmId = extractLetterboxdFilmIdFromResolvablePosterPath(
    $("[data-resolvable-poster-path]")
      .first()
      .attr("data-resolvable-poster-path")
  );
  let linkedTmdbId: number | null = null;
  $('a[href]').each((_, element) => {
    linkedTmdbId ??= tmdbMovieIdFromUrl($(element).attr("href"));
  });
  // The outbound TMDB movie link is Letterboxd's explicit source mapping.
  // Keep the body attribute as a compatibility fallback for pages/templates
  // that omit that link.
  const tmdbId =
    linkedTmdbId ?? positiveInteger($("body").attr("data-tmdb-id"));
  let weightedAverage: number | null = null;
  const posterUrls: string[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).html() ?? $(element).text();
    const value = parseJsonLd(raw);
    if (value === null) return;

    for (const node of objectNodes(value)) {
      title ??= cleanString(node.name);
      year ??= releaseYear(node.datePublished);
      weightedAverage ??= ratingValue(node.aggregateRating);
      collectImageUrls(node.image, posterUrls);
    }
  });

  const openGraphTitle = cleanString(
    $('meta[property="og:title"]').attr("content")
  );
  if (openGraphTitle) {
    const match = openGraphTitle.match(/^(.+?)\s*\((\d{4})\)\s*$/);
    title ??= match?.[1]?.trim() ?? openGraphTitle;
    year ??= match ? releaseYear(match[2]) : null;
  }

  return {
    title,
    year,
    letterboxdFilmId,
    tmdbId,
    weightedAverage,
    posterUrls: [...new Set(posterUrls)],
  };
}

export function parseLetterboxdWeightedAverage(html: string): number | null {
  return parseLetterboxdFilmPage(html).weightedAverage;
}

export function tmdbMovieIdFromUrl(value: string | undefined): number | null {
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value, "https://letterboxd.com");
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "themoviedb.org") return null;

  const match = url.pathname.match(/^\/movie\/(\d+)(?:[-/]|$)/);
  return positiveInteger(match?.[1]);
}

function parseJsonLd(raw: string): unknown | null {
  const cleaned = raw
    .replace(/^\uFEFF/, "")
    .replace(/^\s*<!--\s*<!\[CDATA\[\s*--?>\s*/, "")
    .replace(/\s*<!--?\s*\]\]>\s*-->\s*$/, "")
    .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\/\s*/, "")
    .replace(/\s*\/\*\s*\]\]>\s*\*\/\s*$/, "")
    .replace(/^\s*<!--\s*/, "")
    .replace(/\s*-->\s*$/, "")
    .replace(/^\s*\/\*\s*/, "")
    .replace(/\s*\*\/\s*$/, "")
    .trim();
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function positiveInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function objectNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(objectNodes);
  if (!isRecord(value)) return [];

  const graph = value["@graph"];
  return graph === undefined ? [value] : [value, ...objectNodes(graph)];
}

function ratingValue(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const raw = value.ratingValue;
  const rating =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw)
        : Number.NaN;
  return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null;
}

function releaseYear(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})(?:-|$)/);
  if (!match) return null;
  const year = Number.parseInt(match[1]!, 10);
  return year >= 1870 && year <= 3000 ? year : null;
}

function collectImageUrls(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    const url = cleanString(value);
    if (url) output.push(url);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) collectImageUrls(entry, output);
    return;
  }

  if (!isRecord(value)) return;
  collectImageUrls(value.url, output);
  collectImageUrls(value.contentUrl, output);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
