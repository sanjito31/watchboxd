import { NextResponse } from "next/server";
import { getCached, setCached } from "@/lib/letterboxd/cache";
import { parseUsername } from "@/lib/letterboxd/parseUsername";
import { LetterboxdNotFoundError } from "@/lib/letterboxd/fetchHtml";
import { scrapeUserWatchlist } from "@/lib/letterboxd/scrapeWatchlist";

export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username: raw } = await params;
  const username = parseUsername(raw);

  if (!username) {
    return NextResponse.json(
      { error: "Invalid Letterboxd username" },
      { status: 400 }
    );
  }

  const cached = getCached(username);
  if (cached) {
    return NextResponse.json({
      username: cached.username,
      displayName: cached.displayName,
      avatarUrl: cached.avatarUrl,
      films: cached.films,
      filmCount: cached.films.length,
      fetchedAt: new Date().toISOString(),
      cached: true,
    });
  }

  try {
    const result = await scrapeUserWatchlist(username);
    setCached(username, result);

    return NextResponse.json({
      username: result.username,
      displayName: result.displayName,
      avatarUrl: result.avatarUrl,
      films: result.films,
      filmCount: result.films.length,
      fetchedAt: new Date().toISOString(),
      cached: false,
    });
  } catch (err) {
    if (err instanceof LetterboxdNotFoundError) {
      return NextResponse.json(
        { error: "Letterboxd user not found" },
        { status: 404 }
      );
    }

    console.error("Watchlist scrape failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch watchlist from Letterboxd" },
      { status: 502 }
    );
  }
}
