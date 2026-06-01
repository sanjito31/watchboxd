import type { Film } from "@/lib/types";
import {
  LETTERBOXD_BASE,
  MAX_PAGES,
  PAGE_DELAY_MS,
} from "./constants";
import { fetchHtml, LetterboxdNotFoundError } from "./fetchHtml";
import { parseWatchlistHtml } from "./parseWatchlistPage";
import { scrapeProfile, type ProfileInfo } from "./scrapeProfile";

export interface ScrapeResult {
  username: string;
  displayName?: string;
  avatarUrl?: string;
  films: Film[];
}

export async function scrapeUserWatchlist(
  username: string
): Promise<ScrapeResult> {
  const normalized = username.toLowerCase();

  const [profile, films] = await Promise.all([
    scrapeProfile(normalized).catch(() => ({}) as ProfileInfo),
    scrapeAllWatchlistPages(normalized),
  ]);

  return {
    username: normalized,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    films,
  };
}

async function scrapeAllWatchlistPages(username: string): Promise<Film[]> {
  const bySlug = new Map<string, Film>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      page === 1
        ? `${LETTERBOXD_BASE}/${username}/watchlist/`
        : `${LETTERBOXD_BASE}/${username}/watchlist/page/${page}/`;

    let html: string;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      if (page === 1 && err instanceof LetterboxdNotFoundError) {
        throw err;
      }
      break;
    }

    const pageFilms = parseWatchlistHtml(html);
    if (pageFilms.length === 0) break;

    for (const film of pageFilms) {
      bySlug.set(film.slug, film);
    }

    if (page < MAX_PAGES) {
      await sleep(PAGE_DELAY_MS);
    }
  }

  return Array.from(bySlug.values());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
