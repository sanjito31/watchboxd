import {
  FETCH_RETRIES,
  FETCH_TIMEOUT_MS,
  USER_AGENT,
} from "./constants";

export async function fetchHtml(url: string): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      if (res.status === 404) {
        throw new LetterboxdNotFoundError(url);
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      return await res.text();
    } catch (err) {
      if (err instanceof LetterboxdNotFoundError) throw err;
      lastError =
        err instanceof Error ? err : new Error("Failed to fetch Letterboxd");
      if (attempt < FETCH_RETRIES) {
        await sleep(400 * (attempt + 1));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Failed to fetch Letterboxd");
}

export class LetterboxdNotFoundError extends Error {
  constructor(url: string) {
    super(`Not found: ${url}`);
    this.name = "LetterboxdNotFoundError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
