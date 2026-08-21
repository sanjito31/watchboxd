import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath =
  "prisma/migrations/20260819162000_persistent_scraping_cache/migration.sql";

describe("persistent scraping migration", () => {
  it("contains the active-job partial unique index", async () => {
    const sql = await migrationSql();
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "ScrapeJob_one_active_per_resource"'
    );
    expect(sql).toContain(
      `WHERE "status" IN ('queued', 'running')`
    );
  });

  it("stores Letterboxd and TMDB film identities separately", async () => {
    const sql = await migrationSql();
    expect(sql).toContain('"letterboxdFilmId" INTEGER');
    expect(sql).toContain('"tmdbId" INTEGER');
    expect(sql).toContain('"Movie_letterboxdFilmId_key"');
    expect(sql).toContain('"Movie_tmdbId_key"');
  });

  it("expands safely before dropping legacy worker columns", async () => {
    const sql = await readFile(
      new URL(
        "./migrations/20260821020441_letterboxd_movie_cache_expand/migration.sql",
        import.meta.url
      ),
      "utf8"
    );
    expect(sql).toContain("ADD COLUMN \"letterboxdPoster\" TEXT");
    expect(sql).toContain('CREATE TABLE "MovieAlias"');
    expect(sql).toContain('ALTER COLUMN "sourceTitle" DROP NOT NULL');
    expect(sql).not.toContain('DROP COLUMN "tmdbTitle"');
    expect(sql).toContain('ALTER TABLE "MovieAlias" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("ARRAY['anon', 'authenticated']");
  });

  it("keeps contraction explicit and maps legacy statuses to failed", async () => {
    const sql = await readFile(
      new URL(
        "./migrations/20260821030000_letterboxd_movie_cache_contract/migration.sql",
        import.meta.url
      ),
      "utf8"
    );
    for (const column of [
      "tmdbTitle",
      "tmdbOverview",
      "tmdbGenres",
      "letterboxdPosterUrls",
      "tmdbFetchedAt",
      "sourceTitle",
      "sourceSlug",
    ]) {
      expect(sql).toContain(`DROP COLUMN "${column}"`);
    }
    expect(sql).toContain("ELSE 'failed'");
    expect(sql).toContain("Movie_resolved_cache_complete");
  });

  it("indexes every foreign key and ordered lookup", async () => {
    const sql = await migrationSql();
    for (const index of [
      "WatchlistItem_userId_position_idx",
      "WatchlistItem_movieId_userId_idx",
      "WatchedItem_userId_position_idx",
      "WatchedItem_movieId_userId_idx",
      "NetworkEdge_ownerId_relationship_position_idx",
      "NetworkEdge_memberId_idx",
      "ScrapeJob_status_createdAt_idx",
    ]) {
      expect(sql).toContain(`"${index}"`);
    }
  });

  it("enables RLS without policies and revokes public API roles", async () => {
    const sql = await migrationSql();
    for (const table of [
      "LetterboxdUser",
      "Movie",
      "WatchlistItem",
      "WatchedItem",
      "NetworkEdge",
      "ScrapeJob",
    ]) {
      expect(sql).toContain(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`
      );
    }
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).toContain("ARRAY['anon', 'authenticated']");
    expect(sql).toContain("REVOKE ALL PRIVILEGES ON TABLE");
  });
});

async function migrationSql(): Promise<string> {
  return readFile(new URL(`../${migrationPath}`, import.meta.url), "utf8");
}
