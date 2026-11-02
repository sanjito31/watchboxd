BEGIN;

ALTER TYPE "ScrapeJobFailureCode" ADD VALUE IF NOT EXISTS 'upstream_blocked';

-- Existing snapshots were full replacements, so they start out complete.
ALTER TABLE "LetterboxdUser"
  ADD COLUMN "watchlistComplete" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "watchedComplete" BOOLEAN NOT NULL DEFAULT true;

COMMIT;
