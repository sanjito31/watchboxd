import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHtml: vi.fn<(url: string) => Promise<string>>(),
}));

vi.mock("./fetchHtml", () => ({
  fetchHtml: mocks.fetchHtml,
}));

import { ProviderError } from "./providerErrors";
import { parseProfileHtml, scrapeProfile } from "./scrapeProfile";

describe("scrapeProfile", () => {
  beforeEach(() => {
    mocks.fetchHtml.mockReset();
  });

  it("parses the compact profile header used on network pages", () => {
    expect(
      parseProfileHtml(
        `
          <meta property="og:image" content="https://example.com/default-share.png">
          <div class="profile-mini-person">
            <a class="avatar" href="/alice/">
              <img src="//example.com/alice.jpg" alt="Alice">
            </a>
            <h1><a href="/alice/">Alice Example</a></h1>
          </div>
        `,
        "alice"
      )
    ).toEqual({
      displayName: "Alice Example",
      avatarUrl: "https://example.com/alice.jpg",
    });
  });

  it("falls back to the following page when the profile root is challenged", async () => {
    mocks.fetchHtml
      .mockRejectedValueOnce(
        new ProviderError(
          "Letterboxd request failed with HTTP 403",
          "upstream_unavailable",
          { status: 403 }
        )
      )
      .mockResolvedValueOnce(`
        <div class="profile-mini-person">
          <a class="avatar" href="/alice/"><img src="/alice.jpg"></a>
          <h1><a href="/alice/">Alice Example</a></h1>
        </div>
      `);

    await expect(scrapeProfile("alice")).resolves.toEqual({
      displayName: "Alice Example",
      avatarUrl: "https://letterboxd.com/alice.jpg",
    });
    expect(mocks.fetchHtml.mock.calls).toEqual([
      ["https://letterboxd.com/alice/"],
      ["https://letterboxd.com/alice/following/"],
    ]);
  });

  it("does not hide non-challenge provider failures", async () => {
    const error = new ProviderError("Rate limited", "rate_limited", {
      status: 429,
    });
    mocks.fetchHtml.mockRejectedValue(error);

    await expect(scrapeProfile("alice")).rejects.toBe(error);
    expect(mocks.fetchHtml).toHaveBeenCalledTimes(1);
  });
});
