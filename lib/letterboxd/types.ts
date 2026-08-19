import type { MovieResolutionStatus } from "@/lib/api/contracts";
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
  resolutionStatus: MovieResolutionStatus;
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
}

export interface LetterboxdFilmPageData {
  title: string | null;
  year: number | null;
  letterboxdFilmId: number | null;
  tmdbId: number | null;
  weightedAverage: number | null;
  posterUrls: string[];
}
