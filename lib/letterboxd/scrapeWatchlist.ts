import { scrapeFilmGrid } from "./scrapeFilmGrid";
import { scrapeProfile, type ProfileInfo } from "./scrapeProfile";
import type { LetterboxdFilmGridResult } from "./types";

export type ScrapeResult = LetterboxdFilmGridResult;

export async function scrapeUserWatchlist(
  username: string
): Promise<ScrapeResult> {
  const normalized = username.toLowerCase();

  const [profile, items] = await Promise.all([
    scrapeProfile(normalized).catch(() => ({}) as ProfileInfo),
    scrapeFilmGrid(normalized, "watchlist"),
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
