# Letterboxd-Only Movie Cache and Deferred Enrichment

The cache persists Letterboxd data only. `Movie.tmdbId` is the authoritative
mapping exposed by a Letterboxd film page; watchboxd never calls TMDB.

## Runtime model

- `Movie` stores the canonical Letterboxd slug, nullable Letterboxd film and
  TMDB IDs, title, year, one primary poster, rating, resolution status, and
  Letterboxd freshness timestamps.
- `MovieAlias` maps redirected and alternate slugs to the authoritative movie.
- `WatchlistItem` and `WatchedItem` contain only their ID, user/movie foreign
  keys, and position.
- List workers atomically upsert provisional pending movies, replace the
  relationship snapshot, and create active child movie jobs.
- Child jobs are published after commit with bounded concurrency. If
  publication fails, a later request for the pending movie safely creates a
  fresh job through active-job deduplication.
- Movie workers scrape one Letterboxd film page. Advisory locks serialize
  authoritative identity merges; aliases and list relationships are retained,
  and relationship conflicts keep the lower position.
- A successful Letterboxd scrape resolves a movie even when `tmdbId` is null.
  Terminal failures mark only previously pending movies failed.

## API contract

Both movie routes return:

```ts
interface MovieDto {
  letterboxdSlug: string;
  title: string;
  year: number | null;
  letterboxdFilmId: number | null;
  tmdbId: number | null;
  letterboxdPoster: string | null;
  letterboxdRating: number | null;
}
```

List items contain only `position` and `movie`. Watchlist and watched requests
return `202` only until their list snapshot is available. After that they
return provisional movies without waiting for child enrichment, keep failed
movie enrichment in list pagination, and expose page-scoped
`meta.enrichment` with `complete`, `pendingSlugs`, and `failedSlugs`.
List freshness and refresh jobs are based on the list snapshot itself; movie
freshness is handled by the individual movie routes. Cache metadata exposes
deduplicated `refreshJobs[]`.

## Empty-cache rollout

1. Stop old application instances and queue deliveries.
2. Run `npm run db:deploy`; Prisma applies expansion and contraction in order.
3. Run the explicit cache reset SQL while traffic remains stopped.
4. Deploy the new application and smoke-test list miss → `202` → provisional
   list `200` while child movie jobs continue.
5. Remove retired TMDB secrets from deployment configuration.
