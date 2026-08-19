import { scrapeFilmGrid } from "./scrapeFilmGrid";
import { scrapeProfile, type ProfileInfo } from "./scrapeProfile";
import type { LetterboxdFilmGridResult } from "./types";

export type WatchedScrapeResult = LetterboxdFilmGridResult;

export async function scrapeUserWatched(
  username: string
): Promise<WatchedScrapeResult> {
  const normalized = username.toLowerCase();
  const [profile, items] = await Promise.all([
    scrapeProfile(normalized).catch(() => ({}) as ProfileInfo),
    scrapeFilmGrid(normalized, "films"),
  ]);

  return {
    username: normalized,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    items,
    films: items,
    filmCount: items.length,
    fetchedAt: new Date(),
  };
}

export const scrapeUserWatchedTitles = scrapeUserWatched;
