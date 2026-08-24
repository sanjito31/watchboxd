import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { parseUsername } from "../lib/letterboxd/parseUsername";
import { scrapeFilmGrid } from "../lib/letterboxd/scrapeFilmGrid";
import type { LetterboxdFilmGridResult } from "../lib/letterboxd/types";
import { getJobEnvironment } from "../lib/jobs/publisher";
import { persistFilmGridSnapshot } from "../lib/jobs/workers";

loadEnvConfig(process.cwd());

interface Options {
  username: string;
  directory: string;
  dryRun: boolean;
}

interface SavedPage {
  page: number;
  path: string;
  html: string;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const pages = await loadSavedPages(options.directory);
  const items = await parseSavedPages(options.username, pages);
  const ratedCount = items.filter((item) => item.userRating !== null).length;

  console.log(
    `Parsed ${items.length} watched films from ${pages.length} pages ` +
      `(${ratedCount} rated, ${items.length - ratedCount} unrated).`
  );
  if (options.dryRun) {
    console.log("Dry run complete; the database was not changed.");
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 30_000,
      allowExitOnIdle: true,
    }),
  });
  const snapshot: LetterboxdFilmGridResult = {
    username: options.username,
    items,
    films: items,
    filmCount: items.length,
    fetchedAt: new Date(),
  };

  try {
    await prisma.$transaction(
      (transaction) =>
        persistFilmGridSnapshot(transaction, snapshot, "watched", {
          environment: getJobEnvironment(),
          createMovieJobs: false,
        }),
      { maxWait: 30_000, timeout: 60_000 }
    );

    const [persistedCount, persistedRatedCount] = await Promise.all([
      prisma.watchedItem.count({
        where: { user: { username: options.username } },
      }),
      prisma.watchedItem.count({
        where: {
          user: { username: options.username },
          userRating: { not: null },
        },
      }),
    ]);
    console.log(
      `Imported ${persistedCount} watched films for ${options.username}; ` +
        `${persistedRatedCount} have user ratings.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function loadSavedPages(directory: string): Promise<SavedPage[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = entries.flatMap((entry) => {
    if (!entry.isFile()) return [];
    const match = entry.name.match(/^watched-(\d+)\.html$/);
    return match
      ? [
          {
            page: Number.parseInt(match[1]!, 10),
            path: path.join(directory, entry.name),
          },
        ]
      : [];
  });
  matches.sort((left, right) => left.page - right.page);
  if (matches.length === 0) {
    throw new Error(`No watched-N.html files found in ${directory}`);
  }
  for (const [index, file] of matches.entries()) {
    const expectedPage = index + 1;
    if (file.page !== expectedPage) {
      throw new Error(
        `Saved watched pages must be contiguous from page 1; expected page ${expectedPage}`
      );
    }
  }
  return Promise.all(
    matches.map(async (file) => ({
      ...file,
      html: await readFile(file.path, "utf8"),
    }))
  );
}

async function parseSavedPages(username: string, pages: SavedPage[]) {
  const htmlByPage = new Map(pages.map((page) => [page.page, page.html]));
  const requestedPages = new Set<number>();
  const items = await scrapeFilmGrid(username, "films", {
    maxPages: pages.length,
    pageDelayMs: 0,
    sleep: async () => undefined,
    fetchPage: async (url) => {
      const match = url.match(/\/page\/(\d+)\/$/);
      const page = match ? Number.parseInt(match[1]!, 10) : 1;
      const html = htmlByPage.get(page);
      if (!html) throw new Error(`Saved watched page ${page} is missing`);
      requestedPages.add(page);
      return html;
    },
  });
  if (requestedPages.size !== pages.length) {
    throw new Error(
      `Pagination reached ${requestedPages.size} of ${pages.length} saved pages`
    );
  }
  return items;
}

function parseOptions(args: string[]): Options {
  let rawUsername: string | undefined;
  let directory: string | undefined;
  let dryRun = false;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--directory") {
      directory = args[++index];
      if (!directory) throw new TypeError("--directory requires a path");
    } else if (argument.startsWith("--")) {
      throw new TypeError(`Unknown argument: ${argument}`);
    } else if (rawUsername === undefined) {
      rawUsername = argument;
    } else {
      throw new TypeError(`Unexpected argument: ${argument}`);
    }
  }

  const username = rawUsername ? parseUsername(rawUsername) : null;
  if (!username) {
    throw new TypeError(
      "Usage: npm run watched:import -- <username> [--directory path] [--dry-run]"
    );
  }
  return {
    username,
    directory: path.resolve(directory ?? path.join("data", username)),
    dryRun,
  };
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Watched import failed");
  process.exitCode = 1;
});
