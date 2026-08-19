import { describe, expect, it, vi } from "vitest";
import type { ScrapeResult } from "@/lib/letterboxd";
import { createDefaultWorkerRegistry } from "./workers";

describe("default snapshot workers", () => {
  it("replaces a watchlist snapshot and persists Letterboxd identity", async () => {
    const events: string[] = [];
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      letterboxdUser: {
        upsert: vi.fn().mockResolvedValue({ id: BigInt(1) }),
      },
      movie: {
        findMany: vi.fn().mockResolvedValue([
          { id: BigInt(10), letterboxdSlug: "interstellar" },
        ]),
      },
      watchlistItem: {
        deleteMany: vi.fn(async () => {
          events.push("delete");
          return { count: 1 };
        }),
        createMany: vi.fn(async () => {
          events.push("create");
          return { count: 1 };
        }),
      },
    };
    const snapshot: ScrapeResult = {
      username: "alice",
      items: [
        {
          slug: "interstellar",
          title: "Interstellar",
          year: 2014,
          url: "https://letterboxd.com/film/interstellar/",
          position: 0,
          sourceTitle: "Interstellar",
          sourceSlug: "interstellar",
          sourceYear: 2014,
          resolutionStatus: "pending",
          letterboxdFilmId: 81371,
          letterboxdPosterUrls: ["https://a.ltrbxd.com/poster.jpg"],
        },
      ],
      films: [],
      filmCount: 1,
      fetchedAt: new Date("2026-08-19T12:00:00.000Z"),
    };

    await createDefaultWorkerRegistry().watchlist.persist(
      transaction as never,
      snapshot,
      {
        identifier: "alice",
        fetchedAt: snapshot.fetchedAt,
      }
    );

    expect(events).toEqual(["delete", "create"]);
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.movie.findMany).toHaveBeenCalledWith({
      where: { letterboxdSlug: { in: ["interstellar"] } },
      select: { id: true, letterboxdSlug: true },
    });
    expect(transaction.watchlistItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: BigInt(1),
          movieId: BigInt(10),
          position: 0,
        }),
      ],
    });
  });
});
