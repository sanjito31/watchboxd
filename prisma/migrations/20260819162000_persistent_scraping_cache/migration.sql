-- This is an additive initial migration generated from the frozen Prisma
-- schema. Runtime traffic uses DATABASE_URL (Supavisor transaction mode);
-- migrations must use DIRECT_URL so DDL never runs through a transaction pool.
BEGIN;

-- CreateEnum
CREATE TYPE "MovieResolutionStatus" AS ENUM ('pending', 'resolved', 'unresolved', 'ambiguous');

-- CreateEnum
CREATE TYPE "NetworkRelationship" AS ENUM ('mutual', 'following');

-- CreateEnum
CREATE TYPE "JobEnvironment" AS ENUM ('development', 'preview', 'production');

-- CreateEnum
CREATE TYPE "ScrapeJobType" AS ENUM ('profile', 'watchlist', 'watched', 'network', 'movie');

-- CreateEnum
CREATE TYPE "ScrapeJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ScrapeJobFailureCode" AS ENUM ('invalid_input', 'not_found', 'upstream_unavailable', 'rate_limited', 'timeout', 'parse_error', 'attempts_exhausted', 'unknown');

-- CreateTable
CREATE TABLE "LetterboxdUser" (
    "id" BIGSERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "profileFetchedAt" TIMESTAMPTZ(3),
    "profileStaleAt" TIMESTAMPTZ(3),
    "watchlistFetchedAt" TIMESTAMPTZ(3),
    "watchlistStaleAt" TIMESTAMPTZ(3),
    "watchedFetchedAt" TIMESTAMPTZ(3),
    "watchedStaleAt" TIMESTAMPTZ(3),
    "networkFetchedAt" TIMESTAMPTZ(3),
    "networkStaleAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "LetterboxdUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movie" (
    "id" BIGSERIAL NOT NULL,
    "letterboxdSlug" TEXT NOT NULL,
    "letterboxdFilmId" INTEGER,
    "tmdbId" INTEGER,
    "resolutionStatus" "MovieResolutionStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "tmdbTitle" TEXT,
    "tmdbOriginalTitle" TEXT,
    "tmdbOverview" TEXT,
    "tmdbReleaseDate" DATE,
    "tmdbRuntimeMinutes" INTEGER,
    "tmdbGenres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tmdbVoteAverage" DOUBLE PRECISION,
    "tmdbPosterPath" TEXT,
    "tmdbBackdropPath" TEXT,
    "letterboxdPosterUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "letterboxdRating" DOUBLE PRECISION,
    "tmdbFetchedAt" TIMESTAMPTZ(3),
    "tmdbStaleAt" TIMESTAMPTZ(3),
    "letterboxdFetchedAt" TIMESTAMPTZ(3),
    "letterboxdStaleAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Movie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "movieId" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceSlug" TEXT NOT NULL,
    "sourceYear" INTEGER,
    "resolutionStatus" "MovieResolutionStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchedItem" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "movieId" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceSlug" TEXT NOT NULL,
    "sourceYear" INTEGER,
    "resolutionStatus" "MovieResolutionStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "WatchedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkEdge" (
    "id" BIGSERIAL NOT NULL,
    "ownerId" BIGINT NOT NULL,
    "memberId" BIGINT NOT NULL,
    "relationship" "NetworkRelationship" NOT NULL,
    "position" INTEGER NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "NetworkEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeJob" (
    "id" UUID NOT NULL,
    "environment" "JobEnvironment" NOT NULL,
    "type" "ScrapeJobType" NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "status" "ScrapeJobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "queueMessageId" TEXT,
    "errorCode" "ScrapeJobFailureCode",
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ScrapeJob_pkey" PRIMARY KEY ("id")
);

-- Unique and query indexes
CREATE UNIQUE INDEX "LetterboxdUser_username_key" ON "LetterboxdUser"("username");
CREATE UNIQUE INDEX "Movie_letterboxdSlug_key" ON "Movie"("letterboxdSlug");
CREATE UNIQUE INDEX "Movie_letterboxdFilmId_key" ON "Movie"("letterboxdFilmId");
CREATE UNIQUE INDEX "Movie_tmdbId_key" ON "Movie"("tmdbId");
CREATE INDEX "Movie_resolutionStatus_idx" ON "Movie"("resolutionStatus");
CREATE INDEX "WatchlistItem_userId_position_idx" ON "WatchlistItem"("userId", "position");
CREATE INDEX "WatchlistItem_movieId_userId_idx" ON "WatchlistItem"("movieId", "userId");
CREATE UNIQUE INDEX "WatchlistItem_userId_movieId_key" ON "WatchlistItem"("userId", "movieId");
CREATE INDEX "WatchedItem_userId_position_idx" ON "WatchedItem"("userId", "position");
CREATE INDEX "WatchedItem_movieId_userId_idx" ON "WatchedItem"("movieId", "userId");
CREATE UNIQUE INDEX "WatchedItem_userId_movieId_key" ON "WatchedItem"("userId", "movieId");
CREATE INDEX "NetworkEdge_ownerId_relationship_position_idx" ON "NetworkEdge"("ownerId", "relationship", "position");
CREATE INDEX "NetworkEdge_memberId_idx" ON "NetworkEdge"("memberId");
CREATE UNIQUE INDEX "NetworkEdge_ownerId_memberId_key" ON "NetworkEdge"("ownerId", "memberId");
CREATE UNIQUE INDEX "ScrapeJob_queueMessageId_key" ON "ScrapeJob"("queueMessageId");
CREATE INDEX "ScrapeJob_identity_idx" ON "ScrapeJob"("environment", "type", "resourceKey");
CREATE INDEX "ScrapeJob_status_createdAt_idx" ON "ScrapeJob"("status", "createdAt");

-- Prisma cannot express this partial uniqueness constraint. It is the
-- concurrency authority for create-or-reuse across all application instances.
CREATE UNIQUE INDEX "ScrapeJob_one_active_per_resource"
ON "ScrapeJob" ("environment", "type", "resourceKey")
WHERE "status" IN ('queued', 'running');

-- Foreign keys. Every referencing side is covered by an index above.
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LetterboxdUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WatchedItem" ADD CONSTRAINT "WatchedItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LetterboxdUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WatchedItem" ADD CONSTRAINT "WatchedItem_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetworkEdge" ADD CONSTRAINT "NetworkEdge_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "LetterboxdUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NetworkEdge" ADD CONSTRAINT "NetworkEdge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LetterboxdUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defense in depth for Supabase's exposed public schema. There are
-- intentionally no RLS policies: only the server-side database role may use
-- these cache tables.
ALTER TABLE "LetterboxdUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Movie" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WatchlistItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WatchedItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NetworkEdge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScrapeJob" ENABLE ROW LEVEL SECURITY;

-- Supabase defines these roles; the guards keep migration rehearsal portable
-- to isolated vanilla Postgres databases.
DO $$
DECLARE
    role_name TEXT;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON TABLE "LetterboxdUser", "Movie", "WatchlistItem", "WatchedItem", "NetworkEdge", "ScrapeJob" FROM %I',
                role_name
            );
            EXECUTE format(
                'REVOKE ALL PRIVILEGES ON SEQUENCE "LetterboxdUser_id_seq", "Movie_id_seq", "WatchlistItem_id_seq", "WatchedItem_id_seq", "NetworkEdge_id_seq" FROM %I',
                role_name
            );
        END IF;
    END LOOP;
END
$$;

COMMIT;
