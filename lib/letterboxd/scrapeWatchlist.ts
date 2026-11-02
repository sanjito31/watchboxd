import { scrapeFilmGridBestEffort } from "./scrapeFilmGrid";
import { scrapeProfile, type ProfileInfo } from "./scrapeProfile";
import type { LetterboxdFilmGridResult } from "./types";

export type ScrapeResult = LetterboxdFilmGridResult;

export async function scrapeUserWatchlist(
  username: string
): Promise<ScrapeResult> {
  const normalized = username.toLowerCase();

  // The watchlist root is sorted by date added, so when later pages are
  // challenged the first page still carries the most recent additions.
  const [profile, { items, complete }] = await Promise.all([
    scrapeProfile(normalized).catch(() => ({}) as ProfileInfo),
    scrapeFilmGridBestEffort(normalized, "watchlist"),
  ]);

  return {
    username: normalized,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    items,
    films: items,
    filmCount: items.length,
    fetchedAt: new Date(),
    complete,
  };
}
