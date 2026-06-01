import * as cheerio from "cheerio";
import type { Film } from "@/lib/types";
import { LETTERBOXD_BASE, SELECTORS } from "./constants";
import {
  buildPosterUrlCandidates,
  parseResolvablePosterPath,
} from "./buildPosterUrl";

const TITLE_YEAR_RE = /^(.+?)\s*\((\d{4})\)\s*$/;

export function parseWatchlistHtml(html: string): Film[] {
  const $ = cheerio.load(html);
  const films: Film[] = [];
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

    const posterMeta = parseResolvablePosterPath(
      node.attr(SELECTORS.resolvablePosterPath)
    );

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
    const allPosterUrls = legacyImage
      ? [legacyImage, ...posterUrls]
      : posterUrls;

    films.push({
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

function extractFilmSlug(link: string): string | null {
  const match = link.match(/\/film\/([^/]+)\//);
  return match?.[1] ?? null;
}

function parseTitleYear(
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
