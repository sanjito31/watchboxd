# Letterboxd Watch Party

Compare public Letterboxd watchlists with friends and find films you have in common—no Letterboxd login required.

Add people by username or profile URL, scrape their public watchlists on the server, and browse overlap ranked by how many party members want to see each film (at least 2 in common). The UI uses Letterboxd’s dark palette and shows who has each title with profile avatars.

**Live site:** [https://watchboxd-awj9cp8vv-sanjay-kumars-projects-790869c2.vercel.app/](https://watchboxd-awj9cp8vv-sanjay-kumars-projects-790869c2.vercel.app/)

## Features

- **Watch party** — up to 10 Letterboxd users per party
- **Friend suggestions** — after adding someone, browse their mutual followers and following list to add more people quickly
- **Ranked overlap** — films sorted by overlap count (e.g. 4 of 5 watchlists), 10 per page
- **Shareable links** — party saved in the URL (`?users=alice,bob`) and in `localStorage`
- **Posters** — TMDB-first artwork with ordered Letterboxd and local fallbacks

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

- `TMDB_API_READ_TOKEN` is preferred; `TMDB_API_KEY` is the v3 fallback.
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
Letterboxd, enriches movies through TMDB, and atomically replaces each
snapshot. The browser follows `202 Accepted` job descriptors and computes no
overlap locally.

| Route | Purpose |
|-------|---------|
| `GET /api/v1/users/{username}` | Cached profile or profile job |
| `GET /api/v1/users/{username}/watchlist` | Paginated watchlist |
| `GET /api/v1/users/{username}/watched` | Paginated deduplicated watched titles |
| `GET /api/v1/users/{username}/network` | Mutual and following network |
| `GET /api/v1/movies/{letterboxdSlug}` | TMDB metadata, rating, and poster fallbacks |
| `GET /api/v1/overlap?users=a,b` | Server-computed paginated overlap |
| `GET /api/v1/jobs/{jobId}` | Pollable background-job status |

Fresh responses return `200`; misses return `202` with `Location` and
`Retry-After`; stale snapshots return immediately with a refresh job.

## Deployment checklist

1. Rotate any previously exposed Supabase database password before rollout.
2. Configure `DATABASE_URL`, `DIRECT_URL`, `DATABASE_POOL_MAX`,
   `TMDB_API_READ_TOKEN`, `TMDB_API_KEY`, and `API_ALLOWED_ORIGINS` separately
   for Preview and Production.
3. From a trusted environment, run `npm run db:deploy` with the intended
   `DIRECT_URL`. Never run `db push` for this schema.
4. Deploy `vercel.json` to register the private `queue/v2beta` consumer. Set
   the `scrape-jobs-v1` consumer-group maximum concurrency to **4** in Vercel
   Queue settings/API; the JavaScript trigger schema does not accept
   `maxConcurrency`.
5. Confirm Fluid Compute is enabled and the consumer has a five-minute maximum
   duration.
6. Add a Vercel WAF rate-limit rule for `/api/v1/*`: initially 120 requests per
   minute per IP.
7. On Preview, verify miss → Queue → consumer → Supabase → poll → `200`, then
   inspect retries, oldest-message age, function duration, and database usage
   before promoting to Production.

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
