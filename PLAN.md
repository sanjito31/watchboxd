# Persistent Scraping API with Supabase and Vercel Queues

## Summary

Replace process-local caches with a versioned `/api/v1` backed by Supabase Postgres, run scraping asynchronously through Vercel Queues, and update the current UI to poll asynchronous responses.

Existing scraping behavior remains substantially unchanged. TMDB supplies primary movie metadata and posters, while the Letterboxd poster URLs already extracted by the scraper are persisted and used as fallbacks.

## Data and Scraping Architecture

- Continue using Prisma over Supabase Postgres; do not expose these cache tables directly through the Supabase Data API.
- Add:
  - `LetterboxdUser`: normalized username, display name, avatar, and resource timestamps.
  - `Movie`: separate Letterboxd film ID and TMDB ID, Letterboxd slug, title/year, TMDB metadata and image paths, Letterboxd poster candidates, Letterboxd rating, and source-specific timestamps.
  - `WatchlistItem` and `WatchedItem`: ordered user/movie relationships with source title, slug, and resolution status.
  - `NetworkEdge`: owner, member, relationship (`mutual` or `following`), order, and scraped profile summary.
  - `ScrapeJob`: UUID, environment, type, canonical resource key, status, attempts, queue message ID, timestamps, and sanitized errors.
- Add indexes for ordered user lists, overlap grouping by movie, network lookup, job status, and all foreign keys.
- Add a partial unique index allowing only one active `queued` or `running` job for a given environment, job type, and resource key.
- Enable RLS with no public policies and revoke `anon`/`authenticated` access. Prisma remains the only runtime database path.
- Keep Supavisor transaction mode and configure the `PrismaPg` pool with a low serverless connection limit and no named prepared statements. [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres)

### Film identity and posters

- Preserve existing fetch retries, delays, page limits, and Cheerio selectors.
- Generalize the existing film-grid pagination wrapper for both:
  - `/[username]/watchlist/`
  - `/[username]/films/`
- Retain `film:<id>` from `data-resolvable-poster-path.postered.uid` as Letterboxd's internal film ID; it is not a TMDB ID.
- Read the actual TMDB ID from the film page's `body[data-tmdb-id]`. If it is absent, search TMDB by title/year and accept only a unique exact normalized title and release-year match. Ambiguous results remain explicitly unresolved.
- Persist all Letterboxd poster candidates already produced by `buildPosterUrlCandidates`.
- Poster selection order:
  1. TMDB poster URL
  2. Letterboxd primary poster candidate
  3. Remaining Letterboxd candidates
  4. Local placeholder
- Expose `posterUrl`, `posterSource`, and `posterFallbackUrls` so the frontend can retry sources without another API call.
- Fetch TMDB details using `TMDB_API_READ_TOKEN` as the preferred Bearer credential. If it is absent, fall back to `TMDB_API_KEY` as the v3 `api_key` parameter; production configuration should provide both but normally use the read token. [TMDB authentication](https://developer.themoviedb.org/docs/authentication-application)
- Extract Letterboxd’s weighted average from the film-page JSON-LD. [Letterboxd FAQ](https://letterboxd.com/about/faq/)

## Queue and Duplicate-Job Handling

Use one `scrape-jobs-v1` topic with payloads containing only:

```ts
interface ScrapeQueueMessageV1 {
  version: 1;
  jobId: string;
}
```

A job’s semantic identity is its normalized tuple:

```ts
type JobIdentity = {
  environment: "development" | "preview" | "production";
  type: "profile" | "watchlist" | "watched" | "network" | "movie";
  resourceKey: string;
};
```

Canonical resource keys are:

- `profile:<lowercase-username>`
- `watchlist:<lowercase-username>`
- `watched:<lowercase-username>`
- `network:<lowercase-username>`
- `movie:<lowercase-letterboxd-slug>`

Duplicate handling, briefly:

1. Requests normalize their input and attempt to create a job with the tuple above.
2. The database partial unique index prevents two active jobs with the same tuple.
3. On conflict, the API returns the already-existing job instead of publishing another.
4. Queue publication uses the database job UUID as Vercel’s idempotency key, preventing duplicate publication of that same job.
5. If Vercel redelivers a message, the worker skips a job already marked successful; otherwise its final database operation replaces a snapshot rather than appending to it.

The database constraint determines whether two requests are doing the same work. Vercel’s idempotency key separately protects retries of the same queue publication.

### Worker lifecycle

- Atomically create or reuse the active database job, then publish it.
- If publication fails, mark the job failed.
- If a queued row lacks a message ID for more than one minute, a later API request republishes it with the same UUID idempotency key.
- Configure a private push consumer using `queue/v2beta`, Node.js, Fluid Compute, `maxDuration = 300`, and initial consumer concurrency of four.
- Dispatch jobs to the existing profile, watchlist, and network scrapers; add watched-title and movie enrichment handlers.
- Perform upstream requests outside database transactions. Use a short transaction to replace the snapshot, update freshness, and mark the job successful.
- Retry transient failures with exponential delay for up to five deliveries. Permanently acknowledge invalid input, upstream 404s, and exhausted poison jobs while preserving their failed database record.
- Negative-cache not-found resources for one hour.

## Public API and UI

| Endpoint | Behavior |
|---|---|
| `GET /api/v1/users/{username}` | Cached profile or profile job |
| `GET /api/v1/users/{username}/watchlist?page=1&pageSize=50` | Paginated watchlist, maximum page size 100 |
| `GET /api/v1/users/{username}/watched?page=1&pageSize=50` | Deduplicated watched titles |
| `GET /api/v1/users/{username}/network` | Existing grouped mutual/following result |
| `GET /api/v1/movies/{letterboxdSlug}` | TMDB metadata/poster, Letterboxd rating, and Letterboxd poster fallbacks |
| `GET /api/v1/overlap?users=a,b&page=1&pageSize=10` | Server-computed overlap for 2–10 users |
| `GET /api/v1/jobs/{jobId}` | Pollable job status |

- Fresh data returns `200` with `{ data, meta: { cache: "hit", fetchedAt, staleAt } }`.
- Missing data returns `202` with `Location`, `Retry-After`, and the job descriptor.
- Stale data returns `200` immediately with `cache: "stale"` and a refresh job.
- Errors use `{ error: { code, message } }` without upstream bodies or stack traces.
- Default TTLs remain:
  - Profile and network: 24 hours
  - Watchlist and watched titles: 6 hours
  - Letterboxd rating: 24 hours
  - TMDB metadata: 30 days
- TTL expiry does not automatically create jobs. A job is created only when that stale resource is requested.
- Overlap groups by TMDB ID, falling back to Letterboxd slug for unresolved films, then sorts by overlap count descending and title ascending.
- Missing watchlists cause a `202` with watchlist jobs. Once lists exist, only uncached movies on the requested overlap page are queued for enrichment.
- Add configurable CORS using `API_ALLOWED_ORIGINS`, `OPTIONS`, and `Vary: Origin`.
- Configure a Vercel WAF rule for `/api/v1/*`, initially 120 requests per minute per IP.
- Update the frontend polling client to respect `Retry-After`, use exponential polling capped at ten seconds, and stop after five minutes with a manual retry option.
- Move overlap computation into the API and retire the unversioned routes after the UI migration.

## Hobby-Tier Capacity Estimate

Vercel currently includes one million Queue API operations per month on Hobby. Queue overages start at approximately $0.60 per million in `iad1`, but Hobby generally uses hard usage limits instead of charging overages. [Vercel pricing](https://vercel.com/pricing?a8e726b1_page=4), [regional pricing](https://vercel.com/docs/pricing/regional-pricing/iad1)

A successful job is expected to consume approximately three Queue API operations—send, receive, and acknowledge. Using four operations per job as a conservative allowance for occasional lease extension or retry gives:

- Theoretical Queue ceiling: about 250,000 successful jobs/month.
- Retries and redeliveries reduce that ceiling.
- The queue message is under 1 KB, far below Vercel’s current 100 MB maximum.
- Seven-day retention is acceptable and does not itself create more jobs or refresh data. Vercel Queue provides at-least-once delivery, a maximum seven-day TTL, and no built-in DLQ. [Vercel Queue TTL changelog](https://vercel.com/changelog/queues-now-supports-7-day-ttl)

For resources requested immediately whenever they become stale, monthly jobs are approximately:

```text
jobs/month ≈ 300 × active users + 30 × active movie pages
```

The `300` user jobs represent 30 profile, 30 network, 120 watchlist, and 120 watched-title refreshes per month.

| Continuously active resources | Jobs/month | Estimated queue operations | Queue allowance |
|---|---:|---:|---:|
| 50 users, 500 movies | 30,000 | 90,000–120,000 | 9–12% |
| 100 users, 1,000 movies | 60,000 | 180,000–240,000 | 18–24% |
| 500 users, 2,500 movies | 225,000 | 675,000–900,000 | 68–90% |

These are intentionally pessimistic: they assume every resource is requested again as soon as its TTL expires. In normal personal-project usage, many cached users and movies will not be revisited every day.

Compute is likely to become the practical limit before Queue operations. Hobby Fluid Compute currently includes four active CPU-hours, 360 GB-hours of provisioned memory, one million function invocations, 2 GB memory, and a five-minute maximum invocation. [Fluid Compute pricing](https://vercel.com/docs/functions/usage-and-pricing), [function duration](https://vercel.com/docs/functions/configuring-functions/duration)

At 2 GB, 360 GB-hours represents about 180 total wall-clock function hours. Reserving 25% for API and frontend functions leaves approximately:

| Average worker duration | Approximate monthly worker capacity |
|---|---:|
| 5 seconds | 97,000 jobs |
| 15 seconds | 32,000 jobs |
| 30 seconds | 16,000 jobs |

Cheerio parsing consumes active CPU, while Letterboxd/TMDB network waits mostly consume provisioned memory rather than active CPU. Actual limits therefore depend heavily on watchlist size and upstream latency.

Conclusion:

- The selected TTLs are reasonable for a Hobby personal project because refreshes are demand-driven.
- Around 50 frequently revisited users and 500 frequently displayed movies should fit comfortably.
- Around 100 continuously active users may approach the compute allowance even while Queue operations remain well below their limit.
- Monitor queue operations, active CPU, provisioned memory, worker duration, retries, and oldest-message age.
- If projected usage exceeds 60% of Hobby allowances, first increase watchlist/watched TTLs to 12 hours and rating TTL to 72 hours; keep TMDB at 30 days.
- Keep queue concurrency at four so bursts do not overload Letterboxd, TMDB, or Supabase.

## Test and Rollout Plan

- Extend fixtures for separate Letterboxd and TMDB IDs, missing IDs, watched grids, TMDB and Letterboxd poster precedence, malformed JSON-LD, and ambiguous matching.
- Unit-test canonical job keys, concurrent job creation, partial unique-index behavior, queue publication retries, redelivery, snapshot replacement, and freshness transitions.
- Route-test fresh `200`, missing `202`, stale `200`, duplicate requests returning one job, partial overlap enrichment, CORS, validation, and polling.
- Worker-test transient retries, permanent errors, poison-job acknowledgment, TMDB credential selection, and fallback poster persistence.
- Validate Prisma, generate the client, test migrations against an isolated database, run Vitest/lint/build, and smoke-test the full Queue → consumer → Supabase flow on a preview deployment.
- Configure `TMDB_API_READ_TOKEN`, `TMDB_API_KEY`, `API_ALLOWED_ORIGINS`, Queue trigger, Fluid Compute, and the WAF rule before production deployment.
- Rotate the Supabase database password exposed in the earlier tool transcript before implementation.

## Parallel Multi-Agent Implementation Plan

### Shared contract phase — lead agent, completed first

Freeze these shared resources before parallel work begins:

- Prisma model names, columns, enums, indexes, and migration strategy.
- `lib/jobs/contracts.ts`: job types, statuses, queue message, canonical key builder, and retry error classes.
- `lib/api/contracts.ts`: response envelopes, job summaries, movie/watchlist/network/overlap DTOs, pagination, and error codes.
- `lib/cache/policy.ts`: TTL values and freshness classification.
- `lib/movies/posters.ts`: poster source precedence and output contract.
- File-ownership map below.

The shared contract commit becomes the base commit for all agents. Contract changes after that point require lead-agent approval and notification to every workstream.

### Agent A — database and queue infrastructure

Owns:

- `prisma/`
- `lib/prisma.ts`
- `lib/jobs/`
- Queue consumer route
- `vercel.json`
- Queue-related dependency changes

Delivers:

- Prisma schema and migration
- Active-job partial unique index
- Job repository and atomic create-or-reuse behavior
- Queue publisher and consumer
- Retry, poison-job, and redelivery handling
- Database/queue integration tests

Must not edit scraper, API route, or frontend files.

### Agent B — Letterboxd and TMDB data providers

Owns:

- `lib/letterboxd/`
- New `lib/tmdb/`
- Scraper fixtures and parser/provider tests

Delivers:

- TMDB ID extraction
- Generic film-grid scraper
- Watched-title scraper
- TMDB client using read-token-first authentication
- Movie enrichment and Letterboxd rating parser
- Persistable Letterboxd poster candidates
- Provider-level result types matching the frozen contracts

Must not edit Prisma schema, queue infrastructure, API routes, or frontend components.

### Agent C — API, caching, and overlap service

Owns:

- `app/api/v1/`, excluding the private Queue consumer
- `lib/api/`
- Server-side overlap service and route tests

Delivers:

- Cache hit/miss/stale behavior
- Job creation integration through Agent A’s interface
- Profile, watchlist, watched, network, movie, overlap, and job-status routes
- Pagination, response envelopes, CORS, validation, and standardized errors
- Page-scoped movie enrichment
- API integration tests using mocked provider/queue adapters until Agents A and B merge

Must not edit database schema, scraper internals, or frontend components.

### Agent D — frontend migration

Owns:

- `components/`
- `lib/hooks/`
- Browser-facing UI types and UI tests

Delivers:

- Generic `202` polling client
- New v1 route usage
- Async watchlist/network/overlap states
- TMDB-first poster rendering with Letterboxd fallback candidates
- Timeout, retry, partial-result, and failure UI
- Removal of browser-side overlap computation after the server endpoint is integrated

Must not edit Prisma, worker, scraper, or server route files.

### Integration sequence — lead agent

1. Merge shared contracts.
2. Run Agents A–D in parallel.
3. Merge Agent A and apply the schema to the integration database.
4. Merge Agent B and run parser/provider tests.
5. Rebase Agent C onto A+B, replace mocks with real adapters, and run route tests.
6. Rebase Agent D onto the final API contracts and run UI tests.
7. Remove old unversioned routes and obsolete in-memory cache modules.
8. Run the full test, lint, Prisma validation, production build, migration rehearsal, preview Queue smoke test, and capacity/usage check.
