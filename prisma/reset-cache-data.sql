-- Deliberately preserves Prisma migration history and every Supabase-managed
-- schema. Run only after both watchboxd migrations have been deployed.
TRUNCATE TABLE
  "ScrapeJob",
  "NetworkEdge",
  "WatchlistItem",
  "WatchedItem",
  "MovieAlias",
  "MovieGenre",
  "MovieMetadata",
  "Genre",
  "Movie",
  "LetterboxdUser"
RESTART IDENTITY CASCADE;
