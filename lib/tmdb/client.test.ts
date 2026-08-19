import { describe, expect, it, vi } from "vitest";
import { isProviderNotFoundError } from "@/lib/letterboxd/providerErrors";
import { TmdbClient } from "./client";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const searchResponse = {
  page: 1,
  results: [],
  total_pages: 1,
  total_results: 0,
};

describe("TmdbClient", () => {
  it("prefers the read-token Bearer credential", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(searchResponse)
    );
    const client = new TmdbClient({
      env: {
        TMDB_API_READ_TOKEN: "read-token",
        TMDB_API_KEY: "fallback-key",
      },
      fetch: fetcher,
    });

    await client.searchMovies("Interstellar", 2014);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).not.toContain("api_key");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer read-token"
    );
  });

  it("falls back to the v3 api_key query parameter", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(searchResponse)
    );
    const client = new TmdbClient({
      env: { TMDB_API_KEY: "fallback-key" },
      fetch: fetcher,
    });

    await client.searchMovies("Interstellar", 2014);

    const [url, init] = fetcher.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get("api_key")).toBe(
      "fallback-key"
    );
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("retains the existing two-retry behavior for transient failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(searchResponse));
    const client = new TmdbClient({
      env: { TMDB_API_READ_TOKEN: "token" },
      fetch: fetcher,
      retryDelayMs: 0,
    });

    await expect(client.searchMovies("Interstellar", 2014)).resolves.toEqual(
      searchResponse
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("classifies 404 responses for one-hour negative caching", async () => {
    const client = new TmdbClient({
      env: { TMDB_API_READ_TOKEN: "token" },
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 404)),
    });

    await expect(client.getMovieDetails(999)).rejects.toSatisfy(
      isProviderNotFoundError
    );
  });
});
