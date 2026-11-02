import type { Film } from "@/lib/types";

/**
 * One ordered film-grid item, carrying both the legacy UI shape and the
 * source fields required by WatchlistItem/WatchedItem persistence.
 */
export interface LetterboxdFilmGridItem extends Film {
  position: number;
  sourceTitle: string;
  sourceSlug: string;
  sourceYear: number | null;
  userRating: number | null;
  letterboxdFilmId: number | null;
  letterboxdPosterUrls: string[];
}

export type FilmGridKind = "watchlist" | "films";

export interface LetterboxdFilmGridResult {
  username: string;
  displayName?: string;
  avatarUrl?: string;
  items: LetterboxdFilmGridItem[];
  /** Legacy alias retained for the existing watchlist route and UI. */
  films: LetterboxdFilmGridItem[];
  filmCount: number;
  fetchedAt: Date;
  /**
   * Set when Letterboxd challenged a later page, so only the pages it leaves
   * unchallenged could be read. Partial snapshots are merged into stored data
   * instead of replacing it. Omitted means the scrape read every page.
   */
  partial?: PartialFilmGridScrape;
}

export interface PartialFilmGridScrape {
  /** The page Letterboxd challenged; scraping stopped there. */
  blockedUrl: string;
  /** Grid pages read before the challenge. */
  pagesRead: number;
  /** Films read from those grid pages. */
  gridFilmCount: number;
  /** Films read from the diary RSS feed (watched lists only). */
  diaryFilmCount?: number;
}

export interface LetterboxdFilmPageData {
  title: string | null;
  year: number | null;
  letterboxdFilmId: number | null;
  tmdbId: number | null;
  weightedAverage: number | null;
  posterUrls: string[];
}
