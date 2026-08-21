-- One-time queue repair after deploying a consumer fix.
--
-- Existing Vercel Queue messages are pinned to the deployment that published
-- them. Terminalizing their database rows makes those old deliveries no-ops
-- while preserving every cached user, movie, and list relationship. New API
-- requests create replacement jobs with new IDs on the current deployment.
UPDATE "ScrapeJob"
SET
  "status" = 'failed'::"ScrapeJobStatus",
  "errorCode" = 'timeout'::"ScrapeJobFailureCode",
  "errorMessage" = 'Superseded after queue concurrency repair',
  "finishedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN (
  'queued'::"ScrapeJobStatus",
  'running'::"ScrapeJobStatus"
);

-- FAILED is only assigned to incomplete movies. Let page-scoped API requests
-- create fresh jobs for them under the repaired deployment.
UPDATE "Movie"
SET
  "resolutionStatus" = 'pending'::"MovieResolutionStatus",
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "resolutionStatus" = 'failed'::"MovieResolutionStatus";
