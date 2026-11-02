BEGIN;

-- Terminal status for scrapes that saved data but were partly blocked by
-- Letterboxd. Placed after 'succeeded' so status ordering stays readable.
ALTER TYPE "ScrapeJobStatus" ADD VALUE IF NOT EXISTS 'partial' AFTER 'succeeded';

COMMIT;
