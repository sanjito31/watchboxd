import * as cheerio from "cheerio";
import { parseUsername } from "./parseUsername";

export interface NetworkMember {
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

export function parseNetworkPageHtml(
  html: string,
  excludeUsername?: string
): NetworkMember[] {
  const $ = cheerio.load(html);
  const members: NetworkMember[] = [];
  const seen = new Set<string>();

  $(".person-summary").each((_, el) => {
    const node = $(el);
    const profileHref =
      node.find("a.name").attr("href") ?? node.find("a.avatar").attr("href");
    if (!profileHref) return;

    const username =
      parseUsername(profileHref) ?? extractProfileSlug(profileHref);
    if (!username || seen.has(username)) return;
    if (excludeUsername && username === excludeUsername.toLowerCase()) return;

    seen.add(username);

    const displayName = node.find("a.name").text().trim() || undefined;
    let avatarUrl = node.find("a.avatar img").attr("src");
    if (avatarUrl?.startsWith("//")) {
      avatarUrl = `https:${avatarUrl}`;
    }

    members.push({ username, displayName, avatarUrl });
  });

  return members;
}

function extractProfileSlug(href: string): string | null {
  const match = href.trim().match(/^\/([A-Za-z0-9_-]+)\/?$/);
  return match?.[1]?.toLowerCase() ?? null;
}
