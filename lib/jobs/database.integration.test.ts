import { randomInt, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { enqueueScrapeJob } from "./publisher";
import { createOrReuseJob } from "./repository";
import { createDefaultWorkerRegistry } from "./workers";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  (process.env.ALLOW_PRODUCTION_DB_TESTS === "true"
    ? process.env.DATABASE_URL
    : undefined);

describe.skipIf(!databaseUrl)("database and queue integration", () => {
  let client: PrismaClient;
  const identifier = `integration-${randomUUID()}`;
  const firstLetterboxdFilmId = randomInt(1_500_000_000, 2_000_000_000);
  const identity = {
    environment: "development",
    type: "profile",
    resourceKey: `profile:${identifier}` as `profile:${string}`,
  } as const;

  beforeAll(() => {
    const adapter = new PrismaPg(
      { connectionString: databaseUrl!, max: 1 },
      {
        // No statementNameGenerator: keep transaction-pool compatibility.
      }
    );
    client = new PrismaClient({ adapter });
  });

  afterAll(async () => {
    if (!client) return;
    await client.scrapeJob.deleteMany({
      where: { resourceKey: identity.resourceKey },
    });
    await client.letterboxdUser.deleteMany({ where: { username: identifier } });
    await client.movie.deleteMany({
      where: { letterboxdSlug: { startsWith: `${identifier}-film-` } },
    });
    await client.$disconnect();
  });

  it("atomically reuses one active row under concurrency", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        createOrReuseJob(identity, { client })
      )
    );

    expect(new Set(results.map((result) => result.job.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
  });

  it("publishes with that UUID and persists the returned message id", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "integration-message" });
    const current = await client.scrapeJob.findFirstOrThrow({
      where: { resourceKey: identity.resourceKey, status: "QUEUED" },
    });
    await client.scrapeJob.update({
      where: { id: current.id },
      data: {
        queueMessageId: null,
        updatedAt: new Date(Date.now() - 61_000),
      },
    });

    const result = await enqueueScrapeJob(identity, { client, send });

    expect(result.published).toBe(true);
    expect(result.job.queueMessageId).toBe("integration-message");
    expect(send).toHaveBeenCalledWith(
      "scrape-jobs-v1",
      { version: 1, jobId: current.id },
      expect.objectContaining({ idempotencyKey: current.id })
    );
  });

  it("bulk-upserts multiple persistence batches with separate film identities", async () => {
    const items = Array.from({ length: 101 }, (_, position) => ({
      slug: `${identifier}-film-${position}`,
      title: `Integration Film ${position}`,
      year: 2000 + (position % 20),
      url: `https://letterboxd.com/film/${identifier}-film-${position}/`,
      position,
      sourceTitle: `Integration Film ${position}`,
      sourceSlug: `${identifier}-film-${position}`,
      sourceYear: 2000 + (position % 20),
      resolutionStatus: "pending" as const,
      letterboxdFilmId: firstLetterboxdFilmId + position,
      letterboxdPosterUrls: [
        `https://a.ltrbxd.com/${identifier}-${position}.jpg`,
      ],
    }));
    const fetchedAt = new Date();

    await client.$transaction(
      (transaction) =>
        createDefaultWorkerRegistry().watchlist.persist(
          transaction,
          {
            username: identifier,
            items,
            films: items,
            filmCount: items.length,
            fetchedAt,
          },
          { identifier, fetchedAt }
        ),
      { timeout: 30_000 }
    );

    const [storedItems, firstMovie] = await Promise.all([
      client.watchlistItem.count({
        where: { user: { username: identifier } },
      }),
      client.movie.findUnique({
        where: { letterboxdSlug: `${identifier}-film-0` },
      }),
    ]);
    expect(storedItems).toBe(101);
    expect(firstMovie).toMatchObject({
      letterboxdFilmId: firstLetterboxdFilmId,
      tmdbId: null,
      resolutionStatus: "PENDING",
    });
  });
});
