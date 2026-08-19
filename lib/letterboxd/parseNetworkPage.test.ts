import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseNetworkPage,
  parseNetworkPageHtml,
} from "./parseNetworkPage";

const fixture = readFileSync(
  join(__dirname, "__fixtures__", "network-page.html"),
  "utf-8"
);

describe("parseNetworkPageHtml", () => {
  it("extracts members from person-summary rows", () => {
    const members = parseNetworkPageHtml(fixture, "host");

    expect(members).toHaveLength(2);
    expect(members[0]).toEqual({
      username: "alice",
      displayName: "Alice",
      avatarUrl: "https://a.ltrbxd.com/avatar/alice.jpg",
    });
  });

  it("excludes the profile owner when listed", () => {
    const members = parseNetworkPageHtml(fixture, "alice");
    expect(members.map((m) => m.username)).toEqual(["bob"]);
  });

  it("detects only Letterboxd's scoped next-page control", () => {
    const page = parseNetworkPage(`
      <a class="next" href="/unrelated/">Unrelated</a>
      <div class="pagination">
        <div class="paginate-nextprev">
          <a class="next" href="/host/following/page/2/">Next</a>
        </div>
      </div>
    `);

    expect(page.hasNextPage).toBe(true);
  });

  it("reports no next page when the pagination button is absent", () => {
    expect(parseNetworkPage(fixture).hasNextPage).toBe(false);
  });
});
