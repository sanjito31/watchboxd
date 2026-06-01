export const LETTERBOXD_BASE = "https://letterboxd.com";

export const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export const PAGE_DELAY_MS = 280;
export const MAX_PAGES = 50;
export const NETWORK_PAGE_DELAY_MS = 280;
export const MAX_FOLLOWING_NETWORK_PAGES = 20;
export const MAX_FOLLOWER_NETWORK_PAGES = 40;
export const FETCH_RETRIES = 2;
export const FETCH_TIMEOUT_MS = 30_000;
export const CACHE_TTL_MS = 20 * 60 * 1000;

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export const SELECTORS = {
  poster: 'div[data-item-link*="/film/"], div[data-target-link*="/film/"]',
  itemLink: "data-item-link",
  targetLink: "data-target-link",
  itemName: "data-item-name",
  itemSlug: "data-item-slug",
  image: "data-image",
  resolvablePosterPath: "data-resolvable-poster-path",
} as const;
