import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { requestScrapeJob } from "../lib/jobs/publisher";

loadEnvConfig(process.cwd());

interface Options {
  batchSize: number;
  concurrency: number;
  limit: number | null;
  dryRun: boolean;
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
  let published = 0;
  let failed = 0;

  try {
    while (options.limit === null || selected < options.limit) {
      const take = Math.min(
        options.batchSize,
        options.limit === null ? options.batchSize : options.limit - selected
      );
      const movies = await prisma.movie.findMany({
        where: { resolutionStatus: "PENDING" },
        select: { id: true, letterboxdSlug: true },
        orderBy: { id: "asc" },
        take,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      });
      if (movies.length === 0) break;
      cursor = movies.at(-1)!.id;
      selected += movies.length;
      if (options.dryRun) continue;

      const result = await mapSettled(
        movies,
        options.concurrency,
        ({ letterboxdSlug }) =>
          requestScrapeJob(
            { type: "movie", identifier: letterboxdSlug },
            { client: prisma }
          )
      );
      published += result.fulfilled;
      failed += result.rejected;
      console.log(
        `Processed ${selected} pending movies (${published} jobs ready, ${failed} failed).`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(
    options.dryRun
      ? `Dry run selected ${selected} pending movies.`
      : `Backfill selected ${selected}; ${published} jobs ready; ${failed} failed.`
  );
  if (failed > 0) process.exitCode = 1;
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
        try {
          await operation(values[next++]!);
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
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--dry-run") options.dryRun = true;
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
