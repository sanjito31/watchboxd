import type { ScrapeResult } from "./scrapeWatchlist";
import { CACHE_TTL_MS } from "./constants";

interface CacheEntry {
  data: ScrapeResult;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCached(username: string): ScrapeResult | null {
  const key = username.toLowerCase();
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

export function setCached(username: string, data: ScrapeResult): void {
  cache.set(username.toLowerCase(), {
    data,
    fetchedAt: Date.now(),
  });
}
