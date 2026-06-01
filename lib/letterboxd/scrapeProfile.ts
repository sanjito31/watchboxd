import * as cheerio from "cheerio";
import { LETTERBOXD_BASE } from "./constants";
import { fetchHtml } from "./fetchHtml";

export interface ProfileInfo {
  displayName?: string;
  avatarUrl?: string;
}

export async function scrapeProfile(username: string): Promise<ProfileInfo> {
  const html = await fetchHtml(`${LETTERBOXD_BASE}/${username}/`);
  const $ = cheerio.load(html);

  const ogImage = $('meta[property="og:image"]').attr("content");
  const avatarFromImg =
    $(".profile-avatar img").attr("src") ??
    $('img[alt*="avatar" i]').first().attr("src") ??
    $('img.avatar').attr("src");

  const avatarUrl = normalizeUrl(ogImage ?? avatarFromImg);

  const title = $("title").text().trim();
  const displayName = title
    ? title.replace(/\s*[•·].*$/u, "").replace(/['']s profile$/i, "").trim()
    : undefined;

  const heading = $("h1.profile-name, .profile-name").first().text().trim();

  return {
    displayName: heading || displayName || username,
    avatarUrl,
  };
}

function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}
