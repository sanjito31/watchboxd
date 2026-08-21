import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import pg from "pg";

loadEnvConfig(process.cwd());

const migrationFiles = {
  initial:
    "prisma/migrations/20260819162000_persistent_scraping_cache/migration.sql",
  expansion:
    "prisma/migrations/20260821020441_letterboxd_movie_cache_expand/migration.sql",
  contraction:
    "prisma/migrations/20260821030000_letterboxd_movie_cache_contract/migration.sql",
  repair: "prisma/repair-active-jobs.sql",
  reset: "prisma/reset-cache-data.sql",
} as const;

async function main() {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DIRECT_URL;
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL or DIRECT_URL is required");
  }
  const schema = `migration_rehearsal_${randomUUID().replaceAll("-", "")}`;
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(await migrationSql(migrationFiles.initial));
    await seedLegacyFixtures(client);
    await client.query(await migrationSql(migrationFiles.expansion));
    await assertExpansion(client);
    await seedExpansionCompatibleFixture(client);
    await client.query(await migrationSql(migrationFiles.contraction));
    await assertContraction(client);
    await seedActiveJobs(client);
    await client.query(await migrationSql(migrationFiles.repair));
    await assertActiveJobRepair(client);
    await client.query(await migrationSql(migrationFiles.reset));
    await assertCacheReset(client);
    await client.query("ROLLBACK");
    console.log(
      "Expansion, contraction, active-job repair, and cache reset passed an isolated rollback rehearsal."
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function migrationSql(path: string): Promise<string> {
  return (await readFile(path, "utf8"))
    .replace(/^BEGIN;\s*$/gm, "")
    .replace(/^COMMIT;\s*$/gm, "");
}

async function seedLegacyFixtures(client: pg.Client) {
  await client.query(`
    INSERT INTO "LetterboxdUser" ("username", "updatedAt")
    VALUES ('migration-user', CURRENT_TIMESTAMP);
    INSERT INTO "Movie" (
      "letterboxdSlug", "title", "resolutionStatus",
      "letterboxdPosterUrls", "letterboxdFetchedAt",
      "letterboxdStaleAt", "updatedAt"
    ) VALUES
      ('resolved-film', 'Resolved Film', 'resolved', ARRAY['https://poster/resolved.jpg'], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP),
      ('pending-film', 'Pending Film', 'pending', ARRAY[]::text[], NULL, NULL, CURRENT_TIMESTAMP),
      ('legacy-unresolved', 'Legacy Unresolved', 'unresolved', ARRAY['https://poster/unresolved.jpg'], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP);
    INSERT INTO "WatchlistItem" (
      "userId", "movieId", "position", "sourceTitle", "sourceSlug", "updatedAt"
    ) SELECT users."id", movies."id", 0, movies."title", movies."letterboxdSlug", CURRENT_TIMESTAMP
      FROM "LetterboxdUser" users, "Movie" movies
      WHERE users."username" = 'migration-user' AND movies."letterboxdSlug" = 'resolved-film';
  `);
}

async function seedExpansionCompatibleFixture(client: pg.Client) {
  await client.query(`
    INSERT INTO "Movie" ("letterboxdSlug", "title", "resolutionStatus", "updatedAt")
    VALUES ('new-worker-film', 'New Worker Film', 'pending', CURRENT_TIMESTAMP);
    INSERT INTO "WatchedItem" ("userId", "movieId", "position")
    SELECT users."id", movies."id", 0
      FROM "LetterboxdUser" users, "Movie" movies
      WHERE users."username" = 'migration-user' AND movies."letterboxdSlug" = 'new-worker-film';
    INSERT INTO "MovieAlias" ("slug", "movieId")
    SELECT 'old-resolved-film', "id" FROM "Movie"
    WHERE "letterboxdSlug" = 'resolved-film';
  `);
}

async function assertExpansion(client: pg.Client) {
  const poster = await client.query<{ letterboxdPoster: string | null }>(`
    SELECT "letterboxdPoster" FROM "Movie"
    WHERE "letterboxdSlug" = 'resolved-film'
  `);
  if (poster.rows[0]?.letterboxdPoster !== "https://poster/resolved.jpg") {
    throw new Error("Expansion did not preserve the primary Letterboxd poster");
  }
  const rls = await client.query<{ rowsecurity: boolean }>(`
    SELECT c.relrowsecurity AS rowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'MovieAlias'
  `);
  if (!rls.rows[0]?.rowsecurity) throw new Error("MovieAlias RLS is disabled");
}

async function assertContraction(client: pg.Client) {
  const rows = await client.query<{
    letterboxdSlug: string;
    resolutionStatus: string;
    letterboxdPoster: string | null;
  }>(`
    SELECT "letterboxdSlug", "resolutionStatus"::text AS "resolutionStatus", "letterboxdPoster"
    FROM "Movie" ORDER BY "letterboxdSlug"
  `);
  const unresolved = rows.rows.find(
    (row) => row.letterboxdSlug === "legacy-unresolved"
  );
  if (unresolved?.resolutionStatus !== "failed") {
    throw new Error("Legacy unresolved status was not mapped to failed");
  }
  const legacyColumns = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name IN (
        'tmdbTitle', 'tmdbOverview', 'tmdbFetchedAt',
        'letterboxdPosterUrls', 'sourceTitle', 'sourceSlug'
      )
  `);
  if (legacyColumns.rows[0]?.count !== "0") {
    throw new Error("Contraction retained legacy columns");
  }
  const relationshipCount = await client.query<{ count: string }>(`
    SELECT (
      (SELECT count(*) FROM "WatchlistItem") +
      (SELECT count(*) FROM "WatchedItem")
    )::text AS count
  `);
  if (relationshipCount.rows[0]?.count !== "2") {
    throw new Error("Contraction did not preserve list relationships");
  }
}

async function seedActiveJobs(client: pg.Client) {
  await client.query(`
    INSERT INTO "ScrapeJob" (
      "id", "environment", "type", "resourceKey", "status", "updatedAt"
    ) VALUES
      ('11111111-1111-4111-8111-111111111111', 'development', 'movie', 'movie:pending-film', 'queued', CURRENT_TIMESTAMP),
      ('22222222-2222-4222-8222-222222222222', 'development', 'movie', 'movie:new-worker-film', 'running', CURRENT_TIMESTAMP);
  `);
}

async function assertActiveJobRepair(client: pg.Client) {
  const jobs = await client.query<{
    active: string;
    repaired: string;
  }>(`
    SELECT
      count(*) FILTER (WHERE "status" IN ('queued', 'running'))::text AS active,
      count(*) FILTER (
        WHERE "status" = 'failed'
          AND "errorCode" = 'timeout'
          AND "finishedAt" IS NOT NULL
      )::text AS repaired
    FROM "ScrapeJob"
  `);
  if (jobs.rows[0]?.active !== "0" || jobs.rows[0]?.repaired !== "2") {
    throw new Error("Active-job repair did not safely terminalize queued jobs");
  }
  const cacheRows = await client.query<{ count: string }>(`
    SELECT ((SELECT count(*) FROM "Movie") +
      (SELECT count(*) FROM "WatchlistItem") +
      (SELECT count(*) FROM "WatchedItem"))::text AS count
  `);
  if (cacheRows.rows[0]?.count !== "6") {
    throw new Error("Active-job repair modified cache rows");
  }
  const failedMovies = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count FROM "Movie"
    WHERE "resolutionStatus" = 'failed'
  `);
  if (failedMovies.rows[0]?.count !== "0") {
    throw new Error("Active-job repair did not make failed movies retryable");
  }
}

async function assertCacheReset(client: pg.Client) {
  const rows = await client.query<{ count: string }>(`
    SELECT (
      (SELECT count(*) FROM "ScrapeJob") +
      (SELECT count(*) FROM "NetworkEdge") +
      (SELECT count(*) FROM "WatchlistItem") +
      (SELECT count(*) FROM "WatchedItem") +
      (SELECT count(*) FROM "MovieAlias") +
      (SELECT count(*) FROM "Movie") +
      (SELECT count(*) FROM "LetterboxdUser")
    )::text AS count
  `);
  if (rows.rows[0]?.count !== "0") {
    throw new Error("Cache reset retained watchboxd rows");
  }
}

void main();
