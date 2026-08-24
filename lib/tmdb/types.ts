export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbMovieMetadataSnapshot {
  tmdbId: number;
  runtimeMinutes: number | null;
  overview: string | null;
  tmdbTitle: string | null;
  originalTitle: string | null;
  originalLanguage: string | null;
  tmdbReleaseDate: Date | null;
  tmdbVoteAverage: number | null;
  tmdbPosterPath: string | null;
  tmdbBackdropPath: string | null;
  genres: TmdbGenre[];
  tmdbFetchedAt: Date;
  tmdbStaleAt: Date;
}
