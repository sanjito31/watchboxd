import {
  LETTERBOXD_BASE,
  MAX_PAGES,
  PAGE_DELAY_MS,
} from "./constants";
import { fetchHtml } from "./fetchHtml";
import { isProviderBlockedError } from "./providerErrors";
import {
  hasNextFilmGridPage,
  parseFilmGridHtml,
} from "./parseFilmGridPage";
import type {
  FilmGridKind,
  LetterboxdFilmGridItem,
  PartialFilmGridScrape,
} from "./types";

export interface FilmGridScrapeOptions {
  fetchPage?: (url: string) => Promise<string>;
  maxPages?: number;
  pageDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FilmGridScrapeResult {
  items: LetterboxdFilmGridItem[];
  /** Set when Letterboxd challenged a later page and only earlier pages were read. */
  partial?: PartialFilmGridScrape;
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
 * Scrapes either of Letterboxd's film grids with a bounded safety limit,
 * 280 ms inter-page delay, and fail-closed pagination so an incomplete scrape
 * cannot replace a previously complete snapshot.
 */
export async function scrapeFilmGrid(
  username: string,
  kind: FilmGridKind,
  options: FilmGridScrapeOptions = {}
): Promise<LetterboxdFilmGridItem[]> {
  return (await collectFilmGrid(username, kind, options, false)).items;
}

/**
 * Like scrapeFilmGrid, but when Letterboxd serves a Cloudflare challenge on
 * page 2 or later, returns the pages already read with `partial` details
 * instead of failing. A challenge on page 1 still throws.
 */
export async function scrapeFilmGridBestEffort(
  username: string,
  kind: FilmGridKind,
  options: FilmGridScrapeOptions = {}
): Promise<FilmGridScrapeResult> {
  return collectFilmGrid(username, kind, options, true);
}

async function collectFilmGrid(
  username: string,
  kind: FilmGridKind,
  options: FilmGridScrapeOptions,
  stopWhenBlocked: boolean
): Promise<FilmGridScrapeResult> {
  const normalized = username.toLowerCase();
  const fetchPage = options.fetchPage ?? fetchHtml;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const pageDelayMs = options.pageDelayMs ?? PAGE_DELAY_MS;
  const wait = options.sleep ?? sleep;
  const items: LetterboxdFilmGridItem[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const url = buildFilmGridPageUrl(normalized, kind, page);
    let html: string;
    try {
      html = await fetchPage(url);
    } catch (error) {
      if (stopWhenBlocked && page > 1 && isProviderBlockedError(error)) {
        return {
          items,
          partial: {
            blockedUrl: url,
            pagesRead: page - 1,
            gridFilmCount: items.length,
          },
        };
      }
      throw error;
    }

    const pageItems = parseFilmGridHtml(html);
    if (pageItems.length === 0) {
      if (page === 1 && !hasNextFilmGridPage(html)) break;
      throw new Error(`Film grid page ${page} contained no films`);
    }

    for (const item of pageItems) {
      const identity =
        kind === "films" ? watchedIdentity(item) : `slug:${item.sourceSlug}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      items.push({ ...item, position: items.length });
    }

    if (!hasNextFilmGridPage(html)) break;
    if (page === maxPages) {
      throw new Error(`Film grid exceeded the ${maxPages}-page safety limit`);
    }
    await wait(pageDelayMs);
  }

  return { items };
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
