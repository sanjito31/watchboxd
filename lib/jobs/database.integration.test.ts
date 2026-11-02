import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { createOrReuseJob } from "./repository";
import { persistFilmGridSnapshot } from "./workers";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  (process.env.ALLOW_PRODUCTION_DB_TESTS === "true"
    ? process.env.DATABASE_URL
    : undefined);

describe.skipIf(!databaseUrl)("Letterboxd cache database integration", () => {
  let client: PrismaClient;
  const identifier = `integration-${randomUUID()}`;
  const identity = {
    environment: "development",
    type: "profile",
    resourceKey: `profile:${identifier}` as `profile:${string}`,
  } as const;

  beforeAll(() => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl!, max: 2 }),
    });
  });

  afterAll(async () => {
    if (!client) return;
    await client.scrapeJob.deleteMany({
      where: { resourceKey: { contains: identifier } },
    });
    await client.letterboxdUser.deleteMany({ where: { username: identifier } });
    await client.movie.deleteMany({
      where: { letterboxdSlug: { contains: identifier } },
    });
    await client.$disconnect();
  });

  it("deduplicates concurrent active jobs", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => createOrReuseJob(identity, { client }))
    );
    expect(new Set(results.map((result) => result.job.id))).toHaveLength(1);
  });

  it("persists a lightweight snapshot and child job together", async () => {
    const slug = `${identifier}-film`;
    const item = {
      slug,
      title: "Integration Film",
      year: 2026,
      url: `https://letterboxd.com/film/${slug}/`,
      position: 0,
      sourceTitle: "Integration Film",
      sourceSlug: slug,
      sourceYear: 2026,
      userRating: null,
      letterboxdFilmId: null,
      letterboxdPosterUrls: [],
    };
    await client.$transaction((transaction) =>
      persistFilmGridSnapshot(
        transaction,
        {
          username: identifier,
          items: [item],
          films: [item],
          filmCount: 1,
          fetchedAt: new Date(),
        },
        "watchlist",
        { environment: "development" }
      )
    );

    const stored = await client.watchlistItem.findFirst({
      where: { user: { username: identifier } },
      include: { movie: true },
    });
    const child = await client.scrapeJob.findFirst({
      where: { resourceKey: `movie:${slug}`, status: "QUEUED" },
    });
    expect(stored).toMatchObject({
      position: 0,
      movie: { letterboxdSlug: slug, resolutionStatus: "PENDING" },
    });
    expect(child).not.toBeNull();
  });

  it("merges a partial snapshot ahead of stored items without deleting them", async () => {
    const film = (name: string, position: number, userRating: number | null = null) => {
      const slug = `${identifier}-${name}`;
      return {
        slug,
        title: name,
        year: 2026,
        url: `https://letterboxd.com/film/${slug}/`,
        position,
        sourceTitle: name,
        sourceSlug: slug,
        sourceYear: 2026,
        userRating,
        letterboxdFilmId: null,
        letterboxdPosterUrls: [],
      };
    };
    const persist = (items: ReturnType<typeof film>[], complete: boolean) =>
      client.$transaction((transaction) =>
        persistFilmGridSnapshot(
          transaction,
          {
            username: identifier,
            items,
            films: items,
            filmCount: items.length,
            fetchedAt: new Date(),
            complete,
          },
          "watched",
          { environment: "development", createMovieJobs: false }
        )
      );

    await persist([film("a", 0, 3), film("b", 1), film("c", 2)], true);
    await persist([film("new", 0, 5), film("b", 1, 4)], false);

    const stored = await client.watchedItem.findMany({
      where: { user: { username: identifier } },
      include: { movie: true },
      orderBy: { position: "asc" },
    });
    expect(
      stored.map((item) => [
        item.position,
        item.movie.letterboxdSlug.slice(identifier.length + 1),
        item.userRating,
      ])
    ).toEqual([
      [0, "new", 5],
      [1, "b", 4],
      [2, "a", 3],
      [3, "c", null],
    ]);
    const user = await client.letterboxdUser.findUniqueOrThrow({
      where: { username: identifier },
    });
    expect(user.watchedComplete).toBe(false);
  });
});
