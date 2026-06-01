import {
  LETTERBOXD_BASE,
  MAX_FOLLOWER_NETWORK_PAGES,
  MAX_FOLLOWING_NETWORK_PAGES,
  NETWORK_PAGE_DELAY_MS,
} from "./constants";
import { fetchHtml } from "./fetchHtml";
import {
  parseNetworkPageHtml,
  type NetworkMember,
} from "./parseNetworkPage";

export type NetworkListKind = "following" | "followers";

export interface NetworkScrapeResult {
  username: string;
  mutuals: NetworkMember[];
  following: NetworkMember[];
  followingTotal?: number;
  followersTotal?: number;
  truncated: boolean;
}

export async function scrapeMemberNetwork(
  username: string
): Promise<NetworkScrapeResult> {
  const normalized = username.toLowerCase();

  const [following, followers] = await Promise.all([
    scrapeNetworkList(normalized, "following", MAX_FOLLOWING_NETWORK_PAGES).catch(
      () => [] as NetworkMember[]
    ),
    scrapeNetworkList(normalized, "followers", MAX_FOLLOWER_NETWORK_PAGES).catch(
      () => [] as NetworkMember[]
    ),
  ]);

  const followerSet = new Set(followers.map((m) => m.username));
  const mutuals = following.filter((m) => followerSet.has(m.username));

  const mutualUsernames = new Set(mutuals.map((m) => m.username));
  const followingOnly = following.filter((m) => !mutualUsernames.has(m.username));

  const truncated =
    following.length >= MAX_FOLLOWING_NETWORK_PAGES * 25 ||
    followers.length >= MAX_FOLLOWER_NETWORK_PAGES * 25;

  return {
    username: normalized,
    mutuals,
    following: followingOnly,
    truncated,
  };
}

async function scrapeNetworkList(
  username: string,
  kind: NetworkListKind,
  maxPages: number
): Promise<NetworkMember[]> {
  const byUsername = new Map<string, NetworkMember>();

  for (let page = 1; page <= maxPages; page++) {
    const url =
      page === 1
        ? `${LETTERBOXD_BASE}/${username}/${kind}/`
        : `${LETTERBOXD_BASE}/${username}/${kind}/page/${page}/`;

    let html: string;
    try {
      html = await fetchHtml(url);
    } catch {
      break;
    }

    const batch = parseNetworkPageHtml(html, username);
    if (batch.length === 0) break;

    for (const member of batch) {
      byUsername.set(member.username, member);
    }

    if (page < maxPages) {
      await sleep(NETWORK_PAGE_DELAY_MS);
    }
  }

  return Array.from(byUsername.values());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
