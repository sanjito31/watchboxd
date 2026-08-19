import {
  LETTERBOXD_BASE,
  MAX_PAGES,
  PAGE_DELAY_MS,
} from "./constants";
import { fetchHtml, LetterboxdNotFoundError } from "./fetchHtml";
import { parseFilmGridHtml } from "./parseFilmGridPage";
import type { FilmGridKind, LetterboxdFilmGridItem } from "./types";

export interface FilmGridScrapeOptions {
  fetchPage?: (url: string) => Promise<string>;
  maxPages?: number;
  pageDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function buildFilmGridPageUrl(
  username: string,
  kind: FilmGridKind,
  page: number
): string {
  const root = `${LETTERBOXD_BASE}/${username}/${kind}/`;
  return page === 1 ? root : `${root}page/${page}/`;
}

/**
 * Scrapes either of Letterboxd's film grids with the existing 50-page limit,
 * 280 ms inter-page delay, first-page 404 behavior, and later-page stop
 * behavior.
 */
export async function scrapeFilmGrid(
  username: string,
  kind: FilmGridKind,
  options: FilmGridScrapeOptions = {}
): Promise<LetterboxdFilmGridItem[]> {
  const normalized = username.toLowerCase();
  const fetchPage = options.fetchPage ?? fetchHtml;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const pageDelayMs = options.pageDelayMs ?? PAGE_DELAY_MS;
  const wait = options.sleep ?? sleep;
  const items: LetterboxdFilmGridItem[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    let html: string;
    try {
      html = await fetchPage(buildFilmGridPageUrl(normalized, kind, page));
    } catch (error) {
      if (page === 1 && error instanceof LetterboxdNotFoundError) throw error;
      break;
    }

    const pageItems = parseFilmGridHtml(html);
    if (pageItems.length === 0) break;

    for (const item of pageItems) {
      const identity =
        kind === "films" ? watchedIdentity(item) : `slug:${item.sourceSlug}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      items.push({ ...item, position: items.length });
    }

    if (page < maxPages) await wait(pageDelayMs);
  }

  return items;
}

function watchedIdentity(item: LetterboxdFilmGridItem): string {
  if (item.letterboxdFilmId !== null) {
    return `letterboxd-film:${item.letterboxdFilmId}`;
  }

  const title = item.sourceTitle
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

  return title
    ? `title:${title}:${item.sourceYear ?? ""}`
    : `slug:${item.sourceSlug}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
