import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseNetworkPageHtml } from "./parseNetworkPage";

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
});
