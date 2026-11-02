import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHtml } from "./fetchHtml";
import { ProviderError } from "./providerErrors";

describe("fetchHtml", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("preserves rate-limit classification after built-in retries", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("", {
        status: 429,
        headers: { "Retry-After": "1" },
      })
    );
    vi.stubGlobal("fetch", fetcher);

    const request = fetchHtml("https://letterboxd.com/alice/");
    const rejection = expect(request).rejects.toMatchObject({
      kind: "rate_limited",
      retryAfterSeconds: 1,
      status: 429,
    } satisfies Partial<ProviderError>);
    await vi.runAllTimersAsync();

    await rejection;
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("fails once without retrying when Cloudflare serves a challenge", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html></html>", {
        status: 403,
        headers: { "cf-mitigated": "challenge" },
      })
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      fetchHtml("https://letterboxd.com/alice/films/page/2/")
    ).rejects.toMatchObject({
      kind: "blocked",
      status: 403,
    } satisfies Partial<ProviderError>);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("recognizes a challenge page body without the mitigation header", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<title>Just a moment...</title>", { status: 403 })
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      fetchHtml("https://letterboxd.com/alice/films/page/2/")
    ).rejects.toMatchObject({ kind: "blocked" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
