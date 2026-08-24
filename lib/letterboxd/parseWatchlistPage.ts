import * as cheerio from "cheerio";
import { LETTERBOXD_BASE, SELECTORS } from "./constants";
import {
  buildPosterUrlCandidates,
  extractLetterboxdFilmIdFromResolvablePosterPath,
  parseResolvablePosterPath,
} from "./buildPosterUrl";
import type { LetterboxdFilmGridItem } from "./types";

const TITLE_YEAR_RE = /^(.+?)\s*\((\d{4})\)\s*$/;

export function parseFilmGridHtml(html: string): LetterboxdFilmGridItem[] {
  const $ = cheerio.load(html);
  const films: LetterboxdFilmGridItem[] = [];
  const seen = new Set<string>();

  $(SELECTORS.poster).each((_, el) => {
    const node = $(el);
    const link =
      node.attr(SELECTORS.itemLink) ?? node.attr(SELECTORS.targetLink);
    if (!link || !link.includes("/film/")) return;

    const slug =
      node.attr("data-item-slug")?.trim() || extractFilmSlug(link);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    const rawName = node.attr(SELECTORS.itemName)?.trim();
    const { title, year } = parseTitleYear(rawName, slug);

    const resolvablePosterPath = node.attr(SELECTORS.resolvablePosterPath);
    const posterMeta = parseResolvablePosterPath(resolvablePosterPath);
    const letterboxdFilmId =
      extractLetterboxdFilmIdFromResolvablePosterPath(resolvablePosterPath);

    const width = Number.parseInt(node.attr("data-image-width") ?? "125", 10);
    const height = Number.parseInt(node.attr("data-image-height") ?? "187", 10);

    const posterUrls = posterMeta
      ? buildPosterUrlCandidates(
          slug,
          posterMeta.uid,
          posterMeta.cacheBustingKey,
          Number.isFinite(width) ? width : 125,
          Number.isFinite(height) ? height : 187,
          year
        )
      : [];
    const legacyImage = node.attr(SELECTORS.image);
    const allPosterUrls = [
      ...new Set(legacyImage ? [legacyImage, ...posterUrls] : posterUrls),
    ];
    let userRating: number | null = null;
    let gridItem = node.parent();
    while (gridItem.length > 0) {
      if (gridItem.find(SELECTORS.poster).length > 1) break;

      const viewingData = gridItem.find(SELECTORS.viewingData).first();
      if (viewingData.length > 0) {
        userRating = parseUserRating(viewingData.text());
        break;
      }
      gridItem = gridItem.parent();
    }

    films.push({
      position: films.length,
      sourceTitle: title,
      sourceSlug: slug,
      sourceYear: year ?? null,
      userRating,
      letterboxdFilmId,
      letterboxdPosterUrls: allPosterUrls,
      slug,
      title,
      year,
      url: `${LETTERBOXD_BASE}/film/${slug}/`,
      posterUrl: allPosterUrls[0],
      posterUrls: allPosterUrls.length > 0 ? allPosterUrls : undefined,
    });
  });

  return films;
}

export function hasNextFilmGridPage(html: string): boolean {
  const $ = cheerio.load(html);
  return $(".pagination a.next, .pagination a[rel='next']").length > 0;
}

/** Backward-compatible name used by the current watchlist route. */
export const parseWatchlistHtml = parseFilmGridHtml;

export function parseUserRating(rawRating: string | undefined): number | null {
  if (!rawRating) return null;

  const normalized = rawRating.replace(/\s+/g, "");
  const fullStars = [...normalized].filter((character) => character === "★").length;
  const hasHalfStar = normalized.includes("½") || normalized.includes("1/2");
  if (fullStars === 0 && !hasHalfStar) return null;

  const rating = fullStars + (hasHalfStar ? 0.5 : 0);
  return rating >= 0.5 && rating <= 5 ? rating : null;
}

export function extractFilmSlug(link: string): string | null {
  const match = link.match(/\/film\/([^/]+)\//);
  return match?.[1] ?? null;
}

export function parseTitleYear(
  rawName: string | undefined,
  slug: string
): { title: string; year?: number } {
  if (!rawName) {
    return { title: slugToTitle(slug) };
  }

  const match = rawName.match(TITLE_YEAR_RE);
  if (match) {
    return { title: match[1].trim(), year: Number.parseInt(match[2], 10) };
  }

  return { title: rawName };
}

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
