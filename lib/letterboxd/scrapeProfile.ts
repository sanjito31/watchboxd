import * as cheerio from "cheerio";
import { LETTERBOXD_BASE } from "./constants";
import { fetchHtml } from "./fetchHtml";
import { ProviderError } from "./providerErrors";

export interface ProfileInfo {
  displayName?: string;
  avatarUrl?: string;
}

export async function scrapeProfile(username: string): Promise<ProfileInfo> {
  const profileUrl = `${LETTERBOXD_BASE}/${username}/`;
  let html: string;
  try {
    html = await fetchHtml(profileUrl);
  } catch (error) {
    // Letterboxd sometimes challenges otherwise-public profile roots while
    // leaving the user's network pages accessible. Those pages contain the
    // same compact name/avatar header and are a safe profile fallback.
    if (!(error instanceof ProviderError) || error.status !== 403) throw error;
    html = await fetchHtml(`${LETTERBOXD_BASE}/${username}/following/`);
  }

  return parseProfileHtml(html, username);
}

export function parseProfileHtml(
  html: string,
  username: string
): ProfileInfo {
  const $ = cheerio.load(html);

  const ogImage = $('meta[property="og:image"]').attr("content");
  const avatarFromImg =
    $(".profile-avatar img").attr("src") ??
    $(".profile-mini-person img").first().attr("src") ??
    $('img[alt*="avatar" i]').first().attr("src") ??
    $('img.avatar').attr("src");

  const avatarUrl = normalizeUrl(avatarFromImg ?? ogImage);

  const title = $("title").text().trim();
  const displayName = title
    ? title.replace(/\s*[•·].*$/u, "").replace(/['']s profile$/i, "").trim()
    : undefined;

  const heading = $(
    "h1.profile-name, .profile-name, .profile-mini-person h1"
  )
    .first()
    .text()
    .trim();

  return {
    displayName: heading || displayName || username,
    avatarUrl,
  };
}

function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return new URL(url, LETTERBOXD_BASE).toString();
  return url;
}
