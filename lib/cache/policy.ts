const SECOND_MS = 1_000;
const HOUR_MS = 60 * 60 * SECOND_MS;
export const CACHE_TTL_MS = {
  profile: 24 * HOUR_MS,
  network: 24 * HOUR_MS,
  watchlist: 6 * HOUR_MS,
  watched: 6 * HOUR_MS,
  movie: 24 * HOUR_MS,
  movieMetadata: 90 * 24 * HOUR_MS,
  notFound: 1 * HOUR_MS,
} as const;

export type CacheResource = keyof typeof CACHE_TTL_MS;
export type CacheFreshness = "missing" | "fresh" | "stale";

export interface CacheTimestamps {
  fetchedAt: Date | null | undefined;
  staleAt: Date | null | undefined;
}

export function getCacheTtlMs(resource: CacheResource): number {
  return CACHE_TTL_MS[resource];
}

export function computeStaleAt(
  resource: CacheResource,
  fetchedAt: Date
): Date {
  return new Date(fetchedAt.getTime() + getCacheTtlMs(resource));
}

/**
 * A row without both timestamps is missing. Expiry is inclusive: a resource
 * is stale when `now` is equal to or later than `staleAt`.
 */
export function classifyFreshness(
  timestamps: CacheTimestamps | null | undefined,
  now = new Date()
): CacheFreshness {
  if (!timestamps?.fetchedAt || !timestamps.staleAt) return "missing";

  return now.getTime() < timestamps.staleAt.getTime() ? "fresh" : "stale";
}
