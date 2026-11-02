import * as cheerio from "cheerio";
import { LETTERBOXD_BASE } from "./constants";
import type { LetterboxdFilmGridItem } from "./types";

const DIARY_FILM_LINK_RE = /\/film\/([a-z0-9_-]+)\/(?:\d+\/)?$/i;

/**
 * Parses a member's `/rss/` feed into film-grid items, most recent diary entry
 * first. Non-film entries (lists, plain reviews without a film) and repeat
 * diary entries for the same film are skipped.
 */
export function parseRssFeed(xml: string): LetterboxdFilmGridItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const films: LetterboxdFilmGridItem[] = [];
  const seen = new Set<string>();

  $("item").each((_, el) => {
    const item = $(el);
    const title = item.find("letterboxd\\:filmTitle").first().text().trim();
    const link = item.find("link").first().text().trim();
    const slug = DIARY_FILM_LINK_RE.exec(link)?.[1]?.toLowerCase();
    if (!title || !slug || seen.has(slug)) return;
    seen.add(slug);

    const year = parsePositiveInt(
      item.find("letterboxd\\:filmYear").first().text()
    );
    const rating = Number.parseFloat(
      item.find("letterboxd\\:memberRating").first().text()
    );
    const description = item.find("description").first().text();
    const poster = cheerio.load(description)("img").first().attr("src");
    const posterUrls = poster ? [poster] : [];

    films.push({
      position: films.length,
      sourceTitle: title,
      sourceSlug: slug,
      sourceYear: year ?? null,
      userRating:
        Number.isFinite(rating) && rating > 0 && rating <= 5 ? rating : null,
      letterboxdFilmId: null,
      letterboxdPosterUrls: posterUrls,
      slug,
      title,
      year,
      url: `${LETTERBOXD_BASE}/film/${slug}/`,
      posterUrl: posterUrls[0],
      posterUrls: posterUrls.length > 0 ? posterUrls : undefined,
    });
  });

  return films;
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
