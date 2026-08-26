# TMDB Metadata API Expansion

## 1. Metadata freshness and movie endpoints

- Set the TMDB metadata TTL to 90 days, comfortably below TMDB's recommended
  six-month maximum refresh interval.
- Make both direct movie endpoints (TMDB ID and Letterboxd slug) return the full
  movie representation: existing Letterboxd fields, all stored TMDB metadata,
  and genres.
- When metadata is missing or stale, enqueue one deduplicated TMDB enrichment
  job and return the currently available data without blocking on the refresh.

## 2. Watchlist and watched endpoints

- Add `includeMetadata`, defaulting to `false`, so callers can opt into TMDB
  metadata and genres without enlarging every list response.
- Keep filtering independent of response shaping: metadata filters still work
  when `includeMetadata=false`.
- Support shared filters for title/basic movie fields, year, runtime range,
  release-date range, original language, TMDB rating range, Letterboxd average
  rating range, and genre by ID or name with explicit `any`/`all` semantics.
- Support user-rating filters on watched-list requests.
- Apply filtering, total counts, ordering, and pagination in Postgres before
  constructing the response; load metadata and genres in batches to avoid N+1
  queries.
- Do not fan out refresh jobs for every movie returned by list reads. Direct
  movie requests remain the automatic metadata-refresh trigger, while existing
  discovery workers continue to enqueue enrichment for newly discovered films.

## 3. Watchlist overlap

- Keep watchlist overlap as an intersection across two or more users.
- Add the same metadata, genre, year, and rating filters as the list endpoints,
  plus `includeMetadata` for response shaping.
- Preserve the current route for compatibility; optionally expose the clearer
  `/api/v1/overlap/watchlist` alias.

## 4. Watched overlap

- Add `/api/v1/overlap/watched` for two or more users.
- Return the deduplicated union of their watched movies rather than an
  intersection.
- Include `watchedBy`, each matching user's rating, and `watchedCount` for every
  movie so shared watches remain visible after deduplication.
- Support the shared movie/metadata filters and user-rating filters. Define
  `ratingMode=any|all`, defaulting to `any`, for movies with ratings from
  multiple requested users.
- Support `includeMetadata` using the same behavior as the individual list
  endpoints.

## 5. Database and delivery work

- Centralize query-parameter parsing, validation, filter construction, and DTOs
  so all list and overlap endpoints use identical semantics and error handling.
- Review foreign-key join indexes and use `EXPLAIN (ANALYZE, BUFFERS)` on
  representative filtered and paginated queries. Add only targeted composite
  or partial indexes demonstrated to improve common access patterns.
- Add route/service tests for metadata-present, missing, and stale states;
  filter combinations; genre `any`/`all`; pagination totals; watchlist
  intersection; watched union and attribution; and refresh-job deduplication.
- Update API documentation, examples, generated/client types, and any required
  Prisma migration after the final query shapes and indexes are confirmed.
