# Shared contracts

Status: **frozen on 2026-08-19** for the parallel implementation phase in
[`PLAN.md`](../PLAN.md).

The source-of-truth contract files are:

- `prisma/schema.prisma` for model, field, enum, relation, and explicit index
  names.
- `lib/jobs/contracts.ts` for job identity, status, failure, and the exact
  `scrape-jobs-v1` message shape.
- `lib/api/contracts.ts` for all public v1 response envelopes and DTOs.
- `lib/cache/policy.ts` for TTLs and freshness boundary behavior.
- `lib/movies/posters.ts` for poster selection and browser fallback ordering.

## Database migration contract

- Runtime queries use `DATABASE_URL` with Supavisor transaction mode, a small
  application pool, and unnamed statements. Migration tooling uses
  `DIRECT_URL`; `prisma db push` is not part of this workflow.
- Prisma migrations are committed and reviewed. SQL that Prisma cannot model
  stays hand-authored in the migration: the partial unique active-job index,
  RLS enablement, and revocation of all table and sequence privileges from
  `anon` and `authenticated`.
- The active-job index is the concurrency authority for
  `(environment, type, resourceKey)` while status is `queued` or `running`.
- Public cache tables intentionally have RLS enabled with no public policies.
  Prisma's server-side Postgres connection is the only runtime data path.

## Ownership after the freeze

| Workstream | Owned paths |
| --- | --- |
| Lead/shared | The five source-of-truth files above and this freeze record |
| Agent A: database and queue | Prisma migrations/tests, `lib/prisma.ts`, `lib/jobs/` except `contracts.ts`, `app/api/queues/scrape-jobs/route.ts`, `vercel.json`, queue dependencies; schema changes remain lead-gated |
| Agent B: providers | `lib/letterboxd/`, `lib/tmdb/`, provider fixtures and tests |
| Agent C: API/cache/overlap | `app/api/v1/`, `lib/api/` except `contracts.ts`, excluding the private queue consumer; cache-policy changes remain lead-gated |
| Agent D: frontend | `components/`, `lib/hooks/`, browser-facing UI types and tests |

The schema and shared contract files take precedence if a workstream-local
type drifts from them. A later contract change requires lead-agent approval,
a compatibility note in this document, and notification to every affected
workstream before code is merged.
