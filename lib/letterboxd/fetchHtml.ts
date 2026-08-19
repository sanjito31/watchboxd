import {
  FETCH_RETRIES,
  FETCH_TIMEOUT_MS,
  USER_AGENT,
} from "./constants";
import { ProviderError, ProviderNotFoundError } from "./providerErrors";

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
        throw new ProviderError(
          `Letterboxd request failed with HTTP ${res.status}`,
          res.status === 429 ? "rate_limited" : "upstream_unavailable",
          {
            status: res.status,
            retryAfterSeconds: parseRetryAfter(
              res.headers.get("Retry-After")
            ),
          }
        );
      }

      return await res.text();
    } catch (err) {
      if (err instanceof LetterboxdNotFoundError) throw err;
      lastError =
        err instanceof ProviderError
          ? err
          : new ProviderError(
              controller.signal.aborted
                ? "Letterboxd request timed out"
                : "Letterboxd request failed",
              controller.signal.aborted ? "timeout" : "upstream_unavailable",
              { cause: err }
            );
      if (attempt < FETCH_RETRIES) {
        const retryDelayMs =
          lastError instanceof ProviderError &&
          lastError.retryAfterSeconds !== undefined
            ? lastError.retryAfterSeconds * 1_000
            : 400 * (attempt + 1);
        await sleep(retryDelayMs);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Failed to fetch Letterboxd");
}

export class LetterboxdNotFoundError extends ProviderNotFoundError {
  constructor(url: string) {
    super(`Not found: ${url}`, { status: 404 });
    this.name = "LetterboxdNotFoundError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}
