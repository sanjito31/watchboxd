import type { NetworkScrapeResult } from "./scrapeNetwork";
import { CACHE_TTL_MS } from "./constants";

interface CacheEntry {
  data: NetworkScrapeResult;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedNetwork(username: string): NetworkScrapeResult | null {
  const key = username.toLowerCase();
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

export function setCachedNetwork(
  username: string,
  data: NetworkScrapeResult
): void {
  cache.set(username.toLowerCase(), {
    data,
    fetchedAt: Date.now(),
  });
}
