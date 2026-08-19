import type {
  TmdbMovieProvider,
  TmdbResolutionResult,
  TmdbSearchMovie,
} from "./types";

export function normalizeMovieTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export async function resolveMovieByTitleAndYear(
  client: TmdbMovieProvider,
  title: string,
  year: number | null | undefined
): Promise<TmdbResolutionResult> {
  const normalizedTitle = normalizeMovieTitle(title);
  if (!normalizedTitle || year === null || year === undefined) {
    return unresolved();
  }

  const response = await client.searchMovies(title, year);
  const exactById = new Map<number, TmdbSearchMovie>();

  for (const candidate of response.results) {
    if (releaseYear(candidate.release_date) !== year) continue;

    const candidateTitles = [
      normalizeMovieTitle(candidate.title),
      normalizeMovieTitle(candidate.original_title),
    ];
    if (!candidateTitles.includes(normalizedTitle)) continue;
    exactById.set(candidate.id, candidate);
  }

  const matches = [...exactById.values()];
  if (matches.length === 0) return unresolved();
  if (matches.length > 1) {
    return { status: "ambiguous", tmdbId: null, match: null };
  }

  const match = matches[0]!;
  return { status: "resolved", tmdbId: match.id, match };
}

function releaseYear(releaseDate: string | undefined): number | null {
  const match = releaseDate?.match(/^(\d{4})(?:-|$)/);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function unresolved(): TmdbResolutionResult {
  return { status: "unresolved", tmdbId: null, match: null };
}
