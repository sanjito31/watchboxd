-- This deployment requires old application instances and queue deliveries to
-- be stopped. It follows the expansion in its own transaction so PostgreSQL
-- can commit the newly-added enum value before the enum is rebuilt.
BEGIN;

ALTER TABLE "WatchlistItem"
  DROP COLUMN "sourceTitle",
  DROP COLUMN "sourceSlug",
  DROP COLUMN "sourceYear",
  DROP COLUMN "resolutionStatus",
  DROP COLUMN "createdAt",
  DROP COLUMN "updatedAt";

ALTER TABLE "WatchedItem"
  DROP COLUMN "sourceTitle",
  DROP COLUMN "sourceSlug",
  DROP COLUMN "sourceYear",
  DROP COLUMN "resolutionStatus",
  DROP COLUMN "createdAt",
  DROP COLUMN "updatedAt";

ALTER TABLE "Movie"
  DROP COLUMN "tmdbTitle",
  DROP COLUMN "tmdbOriginalTitle",
  DROP COLUMN "tmdbOverview",
  DROP COLUMN "tmdbReleaseDate",
  DROP COLUMN "tmdbRuntimeMinutes",
  DROP COLUMN "tmdbGenres",
  DROP COLUMN "tmdbVoteAverage",
  DROP COLUMN "tmdbPosterPath",
  DROP COLUMN "tmdbBackdropPath",
  DROP COLUMN "letterboxdPosterUrls",
  DROP COLUMN "tmdbFetchedAt",
  DROP COLUMN "tmdbStaleAt";

ALTER TABLE "Movie" ALTER COLUMN "resolutionStatus" DROP DEFAULT;
ALTER TYPE "MovieResolutionStatus" RENAME TO "MovieResolutionStatus_legacy";
CREATE TYPE "MovieResolutionStatus" AS ENUM ('pending', 'resolved', 'failed');
ALTER TABLE "Movie"
  ALTER COLUMN "resolutionStatus" TYPE "MovieResolutionStatus"
  USING (
    CASE "resolutionStatus"::text
      WHEN 'pending' THEN 'pending'
      WHEN 'resolved' THEN 'resolved'
      ELSE 'failed'
    END
  )::"MovieResolutionStatus";
ALTER TABLE "Movie"
  ALTER COLUMN "resolutionStatus" SET DEFAULT 'pending';
DROP TYPE "MovieResolutionStatus_legacy";

ALTER TABLE "Movie"
ADD CONSTRAINT "Movie_resolved_cache_complete"
CHECK (
  "resolutionStatus" <> 'resolved'
  OR (
    "title" IS NOT NULL
    AND "letterboxdFetchedAt" IS NOT NULL
    AND "letterboxdStaleAt" IS NOT NULL
  )
);

COMMIT;
