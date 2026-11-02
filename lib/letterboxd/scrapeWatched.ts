import { LETTERBOXD_BASE } from "./constants";
import { fetchHtml } from "./fetchHtml";
import { parseRssFeed } from "./parseRssFeed";
import { scrapeFilmGridBestEffort } from "./scrapeFilmGrid";
import { scrapeProfile, type ProfileInfo } from "./scrapeProfile";
import type { LetterboxdFilmGridItem, LetterboxdFilmGridResult } from "./types";

export type WatchedScrapeResult = LetterboxdFilmGridResult;

export async function scrapeUserWatched(
  username: string
): Promise<WatchedScrapeResult> {
  const normalized = username.toLowerCase();
  const [profile, grid] = await Promise.all([
    scrapeProfile(normalized).catch(() => ({}) as ProfileInfo),
    scrapeFilmGridBestEffort(normalized, "films"),
  ]);

  // The /films/ root is sorted by release date, so on its own it cannot show
  // recent watches of older films. The diary RSS feed can, and it is not
  // challenged, so it fills that gap whenever pagination is blocked.
  const items = grid.complete
    ? grid.items
    : mergeRecentFirst(
        await scrapeRecentWatched(normalized).catch(() => []),
        grid.items
      );

  return {
    username: normalized,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    items,
    films: items,
    filmCount: items.length,
    fetchedAt: new Date(),
    complete: grid.complete,
  };
}

/** The member's most recent diary entries (up to 50), newest first. */
export async function scrapeRecentWatched(
  username: string
): Promise<LetterboxdFilmGridItem[]> {
  return parseRssFeed(
    await fetchHtml(`${LETTERBOXD_BASE}/${username.toLowerCase()}/rss/`)
  );
}

/**
 * Puts diary entries first. When a film is in both sources, the grid copy is
 * kept for its Letterboxd film ID and poster candidates (RSS has neither),
 * with the diary's rating taking precedence.
 */
function mergeRecentFirst(
  recent: LetterboxdFilmGridItem[],
  grid: LetterboxdFilmGridItem[]
): LetterboxdFilmGridItem[] {
  const remaining = new Map(grid.map((item) => [item.sourceSlug, item]));
  const merged = recent.map((item) => {
    const gridItem = remaining.get(item.sourceSlug);
    if (!gridItem) return item;
    remaining.delete(item.sourceSlug);
    return { ...gridItem, userRating: item.userRating ?? gridItem.userRating };
  });
  return [...merged, ...remaining.values()].map((item, position) => ({
    ...item,
    position,
  }));
}

export const scrapeUserWatchedTitles = scrapeUserWatched;
