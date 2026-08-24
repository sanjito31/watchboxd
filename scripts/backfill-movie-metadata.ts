import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { retryPostgresDeadlock } from "../lib/database/retryDeadlock";
import { persistMovieMetadataSnapshot } from "../lib/jobs/workers";
import { ProviderError } from "../lib/letterboxd/providerErrors";
import { fetchTmdbMovieMetadata } from "../lib/tmdb";

loadEnvConfig(process.cwd());

interface Options {
  batchSize: number;
  concurrency: number;
  limit: number | null;
  dryRun: boolean;
  all: boolean;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: options.concurrency }),
  });
  let cursor: bigint | undefined;
  let selected = 0;
  let updated = 0;
  let failed = 0;
  const now = new Date();

  try {
    while (options.limit === null || selected < options.limit) {
      const take = Math.min(
        options.batchSize,
        options.limit === null ? options.batchSize : options.limit - selected
      );
      const movies = await prisma.movie.findMany({
        where: {
          tmdbId: { not: null },
          ...(options.all
            ? {}
            : {
                OR: [
                  { metadata: null },
                  { metadata: { is: { tmdbStaleAt: { lte: now } } } },
                ],
              }),
        },
        select: { id: true, tmdbId: true },
        orderBy: { id: "asc" },
        take,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      });
      if (movies.length === 0) break;
      cursor = movies.at(-1)!.id;
      selected += movies.length;
      if (options.dryRun) continue;

      const result = await mapSettled(movies, options.concurrency, async (movie) => {
        const tmdbId = movie.tmdbId!;
        try {
          const snapshot = await fetchWithRetry(tmdbId);
          await retryPostgresDeadlock(() =>
            prisma.$transaction((transaction) =>
              persistMovieMetadataSnapshot(transaction, snapshot)
            )
          );
        } catch (error) {
          throw new Error(
            `TMDB ${tmdbId}: ${
              error instanceof Error ? error.message : "enrichment failed"
            }`,
            { cause: error }
          );
        }
      });
      updated += result.fulfilled;
      failed += result.rejected;
      console.log(
        `Processed ${selected} movies (${updated} updated, ${failed} failed).`
      );
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    options.dryRun
      ? `Dry run selected ${selected} movies for TMDB enrichment.`
      : `Backfill selected ${selected}; ${updated} updated; ${failed} failed.`
  );
  if (failed > 0) process.exitCode = 1;
}

async function fetchWithRetry(tmdbId: number) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchTmdbMovieMetadata(tmdbId);
    } catch (error) {
      if (
        !(error instanceof ProviderError) ||
        !isRetryable(error) ||
        attempt === maxAttempts
      ) {
        throw error;
      }
      const delaySeconds =
        error.retryAfterSeconds ?? Math.min(30, 2 ** (attempt - 1));
      await sleep(delaySeconds * 1_000);
    }
  }
  throw new Error("TMDB enrichment exhausted its retry attempts");
}

function isRetryable(error: ProviderError): boolean {
  return (
    error.kind === "rate_limited" ||
    error.kind === "timeout" ||
    error.kind === "upstream_unavailable"
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function mapSettled<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<unknown>
) {
  let next = 0;
  let fulfilled = 0;
  let rejected = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const value = values[next++]!;
        try {
          await operation(value);
          fulfilled++;
        } catch (error) {
          rejected++;
          console.error(error instanceof Error ? error.message : "Job failed");
        }
      }
    })
  );
  return { fulfilled, rejected };
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    batchSize: 100,
    concurrency: 4,
    limit: null,
    dryRun: false,
    all: false,
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--all") options.all = true;
    else if (argument === "--batch-size") {
      options.batchSize = positiveInteger(args[++index], "batch size");
    } else if (argument === "--concurrency") {
      options.concurrency = positiveInteger(args[++index], "concurrency");
    } else if (argument === "--limit") {
      options.limit = positiveInteger(args[++index], "limit");
    } else {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function positiveInteger(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return Number(value);
}

void main();
