# Letterboxd Watch Party

Compare public Letterboxd watchlists with friends and find films you have in common—no Letterboxd login required.

Add people by username or profile URL, scrape their public watchlists on the server, and browse overlap ranked by how many party members want to see each film (at least 2 in common). The UI uses Letterboxd’s dark palette and shows who has each title with profile avatars.

**Live site:** [https://watchboxd-awj9cp8vv-sanjay-kumars-projects-790869c2.vercel.app/](https://watchboxd-awj9cp8vv-sanjay-kumars-projects-790869c2.vercel.app/)

## Features

- **Watch party** — up to 10 Letterboxd users per party
- **Friend suggestions** — after adding someone, browse their mutual followers and following list to add more people quickly
- **Ranked overlap** — films sorted by overlap count (e.g. 4 of 5 watchlists), 10 per page
- **Shareable links** — party saved in the URL (`?users=alice,bob`) and in `localStorage`
- **Posters** — Letterboxd artwork with a local placeholder fallback

## Getting started

Requires [Node.js](https://nodejs.org/) 22+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Fill `.env.local` with your own development credentials. Never commit that
file. Vercel Queue authentication is provided by Vercel OIDC. The Queue SDK
can exercise the real Queue service while the consumer callback runs in the
local Next.js process. Link the repository to its Vercel project, configure
the Development environment variables there, then start with:

```bash
npx vercel link
npx vercel dev
```

Alternatively, `npx vercel env pull` provisions a short-lived
`VERCEL_OIDC_TOKEN` for `npm run dev`; note that its default target is
`.env.local`, so preserve or configure the existing local values first.

This is not an offline queue emulator: sends still consume Queue operations
and require Vercel authentication. Use a Preview deployment as the final test
of deployed trigger discovery, concurrency, and retry behavior.

### Production build

```bash
npm run build
npm run start
```

### Tests

```bash
npm test
```

### Database

Prisma connects to Supabase using two server-only variables in `.env.local`:

- `DATABASE_URL` uses the transaction-mode pooler for application queries.
- `DIRECT_URL` uses a direct or session-mode connection for migrations and tooling.
- `DATABASE_POOL_MAX` optionally sets the serverless pool size from 1–4
  (default 2). Prisma sends unnamed statements for transaction-pool safety.

Provider and API configuration is also server-only:

- `API_ALLOWED_ORIGINS` is a comma-separated CORS allowlist.
- `TEST_DATABASE_URL` must point to an isolated disposable database when
  running database integration tests.

Production database integration tests are intentionally opt-in. If the
database is disposable and you explicitly intend to use `DATABASE_URL`, run:

```bash
ALLOW_PRODUCTION_DB_TESTS=true node --env-file=.env.local node_modules/vitest/vitest.mjs run lib/jobs/database.integration.test.ts
```

Useful commands:

```bash
npm run db:validate
npm run db:generate
npm run db:test
npm run db:migrate -- --name <migration-name>
npm run db:deploy
npm run db:studio
npm run jobs:backfill-movies -- --dry-run --limit 100
```

After deploying a queue-consumer fix, active messages from an older deployment
can be retired without deleting cache data. The repair also makes incomplete
failed movies pending again. Run this before making a new API request;
requested pages will create replacement jobs naturally:

```bash
npx prisma db execute --file prisma/repair-active-jobs.sql
```

Set both database variables in the deployment environment as well. Generated
Prisma Client files are created automatically during `npm install`.

## Usage

1. Add a Letterboxd username or profile URL (e.g. `letterboxd.com/yourname` or `yourname`).
2. Use **friend suggestions** to add mutuals, or click another party member to browse their network.
3. Click **Find overlap** when everyone is in the party (needs at least 2 members).
4. Use **Copy share link** to send the party URL to friends.

**Start over** clears the party, saved storage, and the URL query string.

Visit `http://localhost:3000/?fresh` once for a blank party without clearing site data manually.

## How it works

Letterboxd has no public API. Requests use the versioned API, which reads
persistent snapshots from Supabase Postgres. Cache misses and stale resources
create idempotent `ScrapeJob` rows and publish a minimal message to the
`scrape-jobs-v1` Vercel Queue topic. The private Node.js consumer scrapes
Letterboxd. List workers atomically save lightweight movies, ordered
relationships, and deduplicated child movie jobs. Movie workers then scrape
only the Letterboxd film page for its title, year, film ID, outbound TMDB ID,
primary poster, and rating. TMDB is never requested by this application; API
consumers can use the returned `tmdbId` directly if they need other metadata.
The browser follows `202 Accepted` job descriptors and computes no overlap
locally.

| Route | Purpose |
|-------|---------|
| `GET /api/v1/users/{username}` | Cached profile or profile job |
| `GET /api/v1/users/{username}/watchlist` | Paginated watchlist |
| `GET /api/v1/users/{username}/watched` | Paginated deduplicated watched titles, including nullable `userRating` |
| `GET /api/v1/users/{username}/network` | Mutual and following network |
| `GET /api/v1/movies/{tmdbId}` | Follow Letterboxd's `/tmdb/{id}/` redirect and return Letterboxd movie data |
| `GET /api/v1/movies/letterboxd/{letterboxdSlug}` | Movie lookup by Letterboxd slug or known alias |
| `GET /api/v1/overlap?users=a,b` | Server-computed paginated overlap |
| `GET /api/v1/jobs/{jobId}` | Pollable background-job status |
| `POST /api/v1/jobs` | Authenticated manual scrape trigger that bypasses cache freshness |

Fresh responses return `200`; cache misses return `202` with `Location` and
`Retry-After`; stale data returns immediately with deduplicated `refreshJobs`.
Once a watchlist or watched snapshot exists, its paginated
response returns provisional title, year, slug, and poster data without waiting
for child movie jobs. Page-scoped `meta.enrichment` reports `complete`,
`pendingSlugs`, and `failedSlugs`. Failed enrichment remains visible in these
two lists; overlap continues to require resolved page movies and omits failed
ones. List responses do not create or inspect per-movie jobs; individual movie
routes handle movie freshness and recovery.

To force a watched-list refresh before its cache becomes stale, configure the
server-only `MANUAL_JOB_API_KEY` environment variable and submit a job:

```bash
curl --request POST "https://your-app.vercel.app/api/v1/jobs" \
  --header "Authorization: Bearer your-manual-job-api-key" \
  --header "Content-Type: application/json" \
  --data '{"type":"watched","identifier":"letterboxd-username"}'
```

The endpoint returns `202 Accepted` with the same pollable job descriptor used
for cache misses. It bypasses freshness checks but still deduplicates an
already queued or running job for the same resource.

## Deployment checklist

1. Rotate any previously exposed Supabase database password before rollout.
2. Configure `DATABASE_URL`, `DIRECT_URL`, `DATABASE_POOL_MAX`, and
   `API_ALLOWED_ORIGINS`, and a long random `MANUAL_JOB_API_KEY` separately for
   Preview and Production.
3. Stop old application instances and queue deliveries, then run
   `npm run db:deploy`. Expansion and contraction are recorded migrations and
   apply in order. Never run `db push` for this schema.
4. With traffic still stopped, run
   `npx prisma db execute --file prisma/reset-cache-data.sql`, deploy the new
   application, and smoke-test list → child movie jobs → page `202` → `200`.
5. Deploy `vercel.json` to register the private `queue/v2beta` consumer.
   Vercel currently documents push-mode maximum concurrency but exposes no
   supported dashboard, trigger, or callback-SDK setting for it. Do not rely on
   that control; use a poll-mode worker or an application-level capacity gate
   before enabling large fan-out in production.
6. Confirm Fluid Compute is enabled and the consumer has a five-minute maximum
   duration.
7. Add a Vercel WAF rate-limit rule for `/api/v1/*`: initially 120 requests per
   minute per IP.
8. On Preview, verify miss → Queue → consumer → Supabase → poll → `200`, then
   inspect retries, oldest-message age, function duration, and database usage
   before promoting to Production.

Run the deployed API smoke test from this repository without a browser:

```bash
npm run api:smoke -- https://your-app.vercel.app letterboxd-username
```

The default checks the user profile and polls any `202` job until it finishes.
Pass `network`, `watchlist`, `watched`, `all`, or a comma-separated selection as
the final argument. Watchlist and watched checks print only the first five
items.

## Stack

- [Next.js](https://nextjs.org/) 16 (App Router)
- React 19, TypeScript, Tailwind CSS 4
- [Vitest](https://vitest.dev/) for unit tests

## Notes

- Watchlists and networks must be **public** on Letterboxd.
- Scraping is best-effort; heavy use or markup changes may cause failures.
- Network scans are bounded (20 following pages and 40 follower pages). The
  frozen database model stores resulting edges but not a separate truncation
  flag, so follower-only truncation can be under-reported after persistence.
- For personal / non-commercial use; respect Letterboxd’s terms and rate limits.
