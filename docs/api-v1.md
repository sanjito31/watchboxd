# API v1 movie lists and overlaps

Direct movie endpoints return the complete `FullMovieDto`. Its `metadata` property
is either the stored TMDB snapshot (including `genres`, `tmdbFetchedAt`, and
`tmdbStaleAt`) or `null`. Missing or stale metadata is returned immediately and
causes one deduplicated `movie_metadata` refresh job when the movie has a TMDB
ID. TMDB metadata becomes stale after 90 days.

## Shared list parameters

The watchlist, watched, watchlist-overlap, and watched-overlap routes accept:

| Parameter | Meaning |
| --- | --- |
| `page`, `pageSize` | Positive integers; `pageSize` is at most 100. |
| `includeMetadata` | `true` or `false`; defaults to `false`. |
| `title` | Case-insensitive substring across Letterboxd, TMDB, and original titles. |
| `letterboxdSlug`, `letterboxdFilmId`, `tmdbId` | Exact basic movie identity filters. |
| `year` | Exact release year. |
| `runtimeMin`, `runtimeMax` | Inclusive runtime range in minutes. |
| `releaseDateFrom`, `releaseDateTo` | Inclusive TMDB release-date range in `YYYY-MM-DD` form. |
| `originalLanguage` | Exact, case-insensitive language code. |
| `tmdbRatingMin`, `tmdbRatingMax` | Inclusive `0`–`10` TMDB vote-average range. |
| `letterboxdRatingMin`, `letterboxdRatingMax` | Inclusive `0`–`5` Letterboxd average-rating range. |
| `genreIds` | Comma-separated TMDB genre IDs. May be repeated. |
| `genres` | Comma-separated, case-insensitive TMDB genre names. May be repeated. |
| `genreMode` | `any` (default) requires at least one supplied genre; `all` requires every supplied ID/name. |

Watched-list and watched-overlap requests additionally accept inclusive
`userRatingMin` and `userRatingMax` values from `0` to `5`.

Filtering, counts, stable ordering, and pagination are executed in Postgres.
`includeMetadata` changes only response shape, so metadata and genre filters
remain active when it is `false`.

```text
GET /api/v1/users/alice/watchlist?includeMetadata=true&runtimeMax=120&genreIds=35,10749&genreMode=any
GET /api/v1/users/alice/watched?userRatingMin=4&originalLanguage=fr
```

## Watchlist overlap

`GET /api/v1/overlap?users=alice,bob` remains available. The clearer
`GET /api/v1/overlap/watchlist?users=alice,bob` alias has identical behavior.
Both require 2–10 unique users and return only movies present on every requested
user's watchlist.

## Watched overlap

`GET /api/v1/overlap/watched?users=alice,bob` returns the deduplicated union of
the requested users' watched movies. Every film includes `watchedBy`, each
matching user's nullable `userRating`, `watchedCount`, and `partySize`.

When a user-rating range is present, `ratingMode=any` (the default) includes a
movie when at least one requested user who watched it has a rating in range.
`ratingMode=all` requires every requested user who watched that movie to have a
non-null rating in range. Attribution still includes all requested users who
watched the returned movie.

```text
GET /api/v1/overlap/watched?users=alice,bob,charlie&userRatingMin=3.5&ratingMode=all&includeMetadata=true
```

## Query-plan review

On 2026-08-25, representative `EXPLAIN (ANALYZE, BUFFERS)` runs against the
configured development database (799 watchlist items, 2,354 watched items, 862
metadata rows, and 1,987 genre links) confirmed use of the existing indexes:

- list lookup used `WatchlistItem_userId_movieId_key`;
- watchlist intersection used the same user/movie index and
  `MovieGenre_pkey`;
- watched union used `WatchedItem_movieId_userId_idx` and the metadata primary
  key.

Representative execution times were approximately 74 ms for the filtered
list, 8 ms for the filtered watchlist intersection, and 19 ms for the filtered
watched union. No new index reduced a demonstrated bottleneck at this data
size, so this change intentionally adds no speculative migration. Re-run the
plans as production cardinality and filter usage grow.
