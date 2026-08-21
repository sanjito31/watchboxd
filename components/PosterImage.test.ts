import { describe, expect, it } from "vitest";
import { buildPosterCandidates } from "./PosterImage";

describe("buildPosterCandidates", () => {
  it("uses the Letterboxd poster then the local placeholder", () => {
    expect(buildPosterCandidates("https://a.ltrbxd.com/primary.jpg")).toEqual([
      "https://a.ltrbxd.com/primary.jpg",
      "/file.svg",
    ]);
  });

  it("uses the placeholder when the movie has no poster", () => {
    expect(buildPosterCandidates(null)).toEqual(["/file.svg"]);
  });
});
