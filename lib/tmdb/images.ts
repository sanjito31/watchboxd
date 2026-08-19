import { TMDB_IMAGE_BASE_URL } from "@/lib/movies/posters";

export const DEFAULT_TMDB_BACKDROP_SIZE = "w780" as const;

export function buildTmdbImageUrl(
  path: string,
  size: string
): string {
  const normalized = path.trim();
  if (!normalized) throw new TypeError("TMDB image path must not be empty");
  return `${TMDB_IMAGE_BASE_URL}/${size}${
    normalized.startsWith("/") ? normalized : `/${normalized}`
  }`;
}

export function buildTmdbBackdropUrl(
  path: string,
  size = DEFAULT_TMDB_BACKDROP_SIZE
): string {
  return buildTmdbImageUrl(path, size);
}
