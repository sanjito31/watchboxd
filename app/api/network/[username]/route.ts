import { NextResponse } from "next/server";
import { parseUsername } from "@/lib/letterboxd/parseUsername";
import { LetterboxdNotFoundError } from "@/lib/letterboxd/fetchHtml";
import {
  getCachedNetwork,
  setCachedNetwork,
} from "@/lib/letterboxd/networkCache";
import { scrapeMemberNetwork } from "@/lib/letterboxd/scrapeNetwork";

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

  const cached = getCachedNetwork(username);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  try {
    const result = await scrapeMemberNetwork(username);
    setCachedNetwork(username, result);

    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    if (err instanceof LetterboxdNotFoundError) {
      return NextResponse.json(
        { error: "Letterboxd user not found" },
        { status: 404 }
      );
    }

    console.error("Network scrape failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch network from Letterboxd" },
      { status: 502 }
    );
  }
}
