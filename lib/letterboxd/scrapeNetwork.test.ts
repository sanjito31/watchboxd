import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHtml: vi.fn<(url: string) => Promise<string>>(),
}));

vi.mock("./fetchHtml", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fetchHtml")>()),
  fetchHtml: mocks.fetchHtml,
}));

import { LetterboxdNotFoundError } from "./fetchHtml";
import { ProviderError } from "./providerErrors";
import { scrapeMemberNetwork } from "./scrapeNetwork";

describe("scrapeMemberNetwork", () => {
  beforeEach(() => {
    mocks.fetchHtml.mockReset();
  });

  it("propagates a first-page not-found for negative caching", async () => {
    mocks.fetchHtml.mockImplementation(async (url) => {
      if (url.includes("/following/")) {
        throw new LetterboxdNotFoundError(url);
      }
      return "<div></div>";
    });

    await expect(scrapeMemberNetwork("missing")).rejects.toBeInstanceOf(
      LetterboxdNotFoundError
    );
  });

  it("propagates transient failures instead of persisting an empty snapshot", async () => {
    const failure = new ProviderError(
      "Letterboxd unavailable",
      "upstream_unavailable"
    );
    mocks.fetchHtml.mockRejectedValue(failure);

    await expect(scrapeMemberNetwork("alice")).rejects.toBe(failure);
  });

  it("does not request another page when Letterboxd has no next button", async () => {
    mocks.fetchHtml.mockImplementation(async (url) =>
      networkPage(url.includes("/following/") ? 13 : 11)
    );

    const result = await scrapeMemberNetwork("alice");

    expect(mocks.fetchHtml).toHaveBeenCalledTimes(2);
    expect(mocks.fetchHtml).toHaveBeenCalledWith(
      "https://letterboxd.com/alice/following/"
    );
    expect(mocks.fetchHtml).toHaveBeenCalledWith(
      "https://letterboxd.com/alice/followers/"
    );
    expect(result.mutuals).toHaveLength(11);
    expect(result.following).toHaveLength(2);
  });

  it("requests the next page only when Letterboxd provides a next button", async () => {
    mocks.fetchHtml.mockImplementation(async (url) => {
      if (url.endsWith("/following/")) {
        return networkPage(25, "/alice/following/page/2/");
      }
      if (url.endsWith("/following/page/2/")) {
        return networkPage(1, undefined, 25);
      }
      return networkPage(0);
    });

    const result = await scrapeMemberNetwork("alice");

    expect(mocks.fetchHtml).toHaveBeenCalledWith(
      "https://letterboxd.com/alice/following/page/2/"
    );
    expect(mocks.fetchHtml).not.toHaveBeenCalledWith(
      "https://letterboxd.com/alice/following/page/3/"
    );
    expect(result.following).toHaveLength(26);
  });
});

function networkPage(
  count: number,
  nextHref?: string,
  startIndex = 0
): string {
  const members = Array.from(
    { length: count },
    (_, offset) => {
      const index = startIndex + offset;
      return `
      <div class="person-summary">
        <a class="avatar" href="/member-${index}/"><img src="/avatar.jpg"></a>
        <a class="name" href="/member-${index}/">Member ${index}</a>
      </div>
    `;
    }
  ).join("");
  const pagination = nextHref
    ? `<div class="pagination"><div class="paginate-nextprev"><a class="next" href="${nextHref}">Next</a></div></div>`
    : "";
  return `${members}${pagination}`;
}
