const TMDB_JOB_IDENTIFIER_PREFIX = "tmdb_";
export const MAX_TMDB_MOVIE_ID = 2_147_483_647;

export type MovieJobIdentifier =
  | { kind: "tmdb"; tmdbId: number }
  | { kind: "letterboxd"; letterboxdSlug: string };

export function buildTmdbMovieJobIdentifier(tmdbId: number): string {
  assertTmdbId(tmdbId);
  return `${TMDB_JOB_IDENTIFIER_PREFIX}${tmdbId}`;
}

export function parseMovieJobIdentifier(identifier: string): MovieJobIdentifier {
  if (!identifier.startsWith(TMDB_JOB_IDENTIFIER_PREFIX)) {
    return { kind: "letterboxd", letterboxdSlug: identifier };
  }

  const rawTmdbId = identifier.slice(TMDB_JOB_IDENTIFIER_PREFIX.length);
  if (!/^[1-9]\d*$/.test(rawTmdbId)) {
    throw new TypeError("Invalid TMDB movie job identifier");
  }

  const tmdbId = Number(rawTmdbId);
  assertTmdbId(tmdbId);
  return { kind: "tmdb", tmdbId };
}

function assertTmdbId(tmdbId: number): void {
  if (
    !Number.isSafeInteger(tmdbId) ||
    tmdbId <= 0 ||
    tmdbId > MAX_TMDB_MOVIE_ID
  ) {
    throw new TypeError("TMDB movie ID is outside the supported range");
  }
}
