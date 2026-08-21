BEGIN;

-- Expansion-only migration. Legacy columns remain until the old deployment's
-- queue deliveries have drained. For the selected empty-cache rollout, the
-- matching contraction is the next migration and deploys in the same window.
ALTER TYPE "MovieResolutionStatus" ADD VALUE IF NOT EXISTS 'failed';

ALTER TABLE "Movie" ADD COLUMN "letterboxdPoster" TEXT;
UPDATE "Movie"
SET "letterboxdPoster" = "letterboxdPosterUrls"[1]
WHERE cardinality("letterboxdPosterUrls") > 0;

CREATE TABLE "MovieAlias" (
    "slug" TEXT NOT NULL,
    "movieId" BIGINT NOT NULL,
    CONSTRAINT "MovieAlias_pkey" PRIMARY KEY ("slug")
);

CREATE INDEX "MovieAlias_movieId_idx" ON "MovieAlias"("movieId");
ALTER TABLE "MovieAlias"
ADD CONSTRAINT "MovieAlias_movieId_fkey"
FOREIGN KEY ("movieId") REFERENCES "Movie"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- New workers omit the duplicated relation fields. Relax them while old
-- workers still coexist with the new schema.
ALTER TABLE "WatchlistItem"
  ALTER COLUMN "sourceTitle" DROP NOT NULL,
  ALTER COLUMN "sourceSlug" DROP NOT NULL,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WatchedItem"
  ALTER COLUMN "sourceTitle" DROP NOT NULL,
  ALTER COLUMN "sourceSlug" DROP NOT NULL,
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "MovieAlias" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    role_name TEXT;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON TABLE "MovieAlias" FROM %I',
                role_name
            );
        END IF;
    END LOOP;
END
$$;

COMMIT;
