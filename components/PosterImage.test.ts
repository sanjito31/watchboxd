import { describe, expect, it } from "vitest";
import { buildPosterCandidates } from "./PosterImage";

describe("buildPosterCandidates", () => {
  it("keeps the API poster order and ends with the local placeholder", () => {
    expect(
      buildPosterCandidates("https://image.tmdb.org/t/p/w500/tmdb.jpg", [
        "https://a.ltrbxd.com/primary.jpg",
        "https://a.ltrbxd.com/fallback.jpg",
      ])
    ).toEqual([
      "https://image.tmdb.org/t/p/w500/tmdb.jpg",
      "https://a.ltrbxd.com/primary.jpg",
      "https://a.ltrbxd.com/fallback.jpg",
      "/file.svg",
    ]);
  });

  it("deduplicates fallbacks without changing precedence", () => {
    expect(
      buildPosterCandidates("/file.svg", ["/file.svg", "/other.jpg"])
    ).toEqual(["/file.svg", "/other.jpg"]);
  });
});
