import { NextResponse } from "next/server";
import { LETTERBOXD_BASE, CACHE_TTL_MS } from "@/lib/letterboxd/constants";
import { fetchHtml } from "@/lib/letterboxd/fetchHtml";
import { parseUsername } from "@/lib/letterboxd/parseUsername";

const cache = new Map<string, { url: string; fetchedAt: number }>();

function parsePosterFromFilmPage(html: string): string | null {
  const match = html.match(
    /<script type="application\/ld\+json">\s*\/\*[\s\S]*?\*\/\s*(\{[\s\S]*?\})\s*\/\*/
  );
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]!) as { image?: string };
    return typeof data.image === "string" ? data.image : null;
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug: raw } = await params;
  const slug = parseUsername(raw) ?? raw.toLowerCase();

  if (!slug || !/^[a-z0-9_-]+$/i.test(slug)) {
    return NextResponse.json({ error: "Invalid film slug" }, { status: 400 });
  }

  const cached = cache.get(slug);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ posterUrl: cached.url });
  }

  try {
    const html = await fetchHtml(`${LETTERBOXD_BASE}/film/${slug}/`);
    const posterUrl = parsePosterFromFilmPage(html);

    if (!posterUrl) {
      return NextResponse.json({ error: "Poster not found" }, { status: 404 });
    }

    cache.set(slug, { url: posterUrl, fetchedAt: Date.now() });
    return NextResponse.json({ posterUrl });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch poster from Letterboxd" },
      { status: 502 }
    );
  }
}
