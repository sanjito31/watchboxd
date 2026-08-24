BEGIN;

ALTER TYPE "ScrapeJobType" ADD VALUE IF NOT EXISTS 'movie_metadata';

CREATE TABLE "MovieMetadata" (
    "movieId" BIGINT NOT NULL,
    "runtimeMinutes" INTEGER,
    "overview" TEXT,
    "tmdbTitle" TEXT,
    "originalTitle" TEXT,
    "originalLanguage" TEXT,
    "tmdbReleaseDate" DATE,
    "tmdbVoteAverage" DOUBLE PRECISION,
    "tmdbPosterPath" TEXT,
    "tmdbBackdropPath" TEXT,
    "tmdbFetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "tmdbStaleAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "MovieMetadata_pkey" PRIMARY KEY ("movieId"),
    CONSTRAINT "MovieMetadata_runtimeMinutes_check"
      CHECK ("runtimeMinutes" IS NULL OR "runtimeMinutes" >= 0),
    CONSTRAINT "MovieMetadata_tmdbVoteAverage_check"
      CHECK (
        "tmdbVoteAverage" IS NULL
        OR ("tmdbVoteAverage" >= 0 AND "tmdbVoteAverage" <= 10)
      ),
    CONSTRAINT "MovieMetadata_staleAt_check"
      CHECK ("tmdbStaleAt" >= "tmdbFetchedAt")
);

CREATE TABLE "Genre" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Genre_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Genre_id_check" CHECK ("id" > 0),
    CONSTRAINT "Genre_name_check" CHECK (length(btrim("name")) > 0)
);

CREATE TABLE "MovieGenre" (
    "movieId" BIGINT NOT NULL,
    "genreId" INTEGER NOT NULL,
    CONSTRAINT "MovieGenre_pkey" PRIMARY KEY ("movieId", "genreId")
);

CREATE INDEX "MovieMetadata_tmdbStaleAt_idx"
ON "MovieMetadata"("tmdbStaleAt");
CREATE INDEX "MovieGenre_genreId_idx" ON "MovieGenre"("genreId");

ALTER TABLE "MovieMetadata"
ADD CONSTRAINT "MovieMetadata_movieId_fkey"
FOREIGN KEY ("movieId") REFERENCES "Movie"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MovieGenre"
ADD CONSTRAINT "MovieGenre_movieId_fkey"
FOREIGN KEY ("movieId") REFERENCES "MovieMetadata"("movieId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MovieGenre"
ADD CONSTRAINT "MovieGenre_genreId_fkey"
FOREIGN KEY ("genreId") REFERENCES "Genre"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MovieMetadata" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Genre" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MovieGenre" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    role_name TEXT;
    table_name TEXT;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            FOREACH table_name IN ARRAY ARRAY['MovieMetadata', 'Genre', 'MovieGenre']
            LOOP
                EXECUTE format(
                    'REVOKE ALL PRIVILEGES ON TABLE %I FROM %I',
                    table_name,
                    role_name
                );
            END LOOP;
        END IF;
    END LOOP;
END
$$;

COMMIT;
