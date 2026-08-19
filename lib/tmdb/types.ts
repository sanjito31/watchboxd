import type { MovieResolutionStatus } from "@/lib/api/contracts";

export interface TmdbSearchMovie {
  id: number;
  title: string;
  original_title: string;
  release_date?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
}

export interface TmdbSearchResponse {
  page: number;
  results: TmdbSearchMovie[];
  total_pages: number;
  total_results: number;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date?: string;
  runtime: number | null;
  genres: TmdbGenre[];
  vote_average: number;
  poster_path: string | null;
  backdrop_path: string | null;
}

export interface TmdbResolutionResult {
  status: Extract<
    MovieResolutionStatus,
    "resolved" | "unresolved" | "ambiguous"
  >;
  tmdbId: number | null;
  match: TmdbSearchMovie | null;
}

export interface TmdbMovieProvider {
  searchMovies(title: string, year?: number | null): Promise<TmdbSearchResponse>;
  getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails>;
}
