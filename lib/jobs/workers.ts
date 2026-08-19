import { Prisma } from "@/lib/generated/prisma/client";
import { computeStaleAt } from "@/lib/cache/policy";
import {
  enrichMovie,
  scrapeMemberNetwork,
  scrapeProfile,
  scrapeUserWatched,
  scrapeUserWatchlist,
  type MovieEnrichmentResult,
  type NetworkScrapeResult,
  type ProfileInfo,
  type WatchedScrapeResult,
  type ScrapeResult,
} from "@/lib/letterboxd";
import type { LetterboxdFilmGridItem } from "@/lib/letterboxd/types";
import { PermanentJobError } from "./contracts";
import { parseCanonicalResourceKey, type JobType } from "./contracts";
import type { JobRecord } from "./repository";

export type PersistenceTransaction = Prisma.TransactionClient;

const PERSISTENCE_BATCH_SIZE = 100;
const MAX_FILM_SNAPSHOT_ITEMS = 5_000;
const MAX_NETWORK_SNAPSHOT_MEMBERS = 1_500;

export interface SnapshotJobWorker<TSnapshot> {
  /** Performs all upstream I/O. This is always called before a DB transaction. */
  fetch(identifier: string): Promise<TSnapshot>;
  /** Replaces one complete resource snapshot in a short DB transaction. */
  persist(
    transaction: PersistenceTransaction,
    snapshot: TSnapshot,
    context: { identifier: string; fetchedAt: Date }
  ): Promise<void>;
}

export interface JobWorkerRegistry {
  profile: SnapshotJobWorker<ProfileInfo>;
  watchlist: SnapshotJobWorker<ScrapeResult>;
  watched: SnapshotJobWorker<WatchedScrapeResult>;
  network: SnapshotJobWorker<NetworkScrapeResult>;
  movie: SnapshotJobWorker<MovieEnrichmentResult>;
}

export interface PreparedJobSnapshot {
  persist(transaction: PersistenceTransaction): Promise<void>;
}

export async function prepareJobSnapshot(
  job: JobRecord,
  registry: JobWorkerRegistry = createDefaultWorkerRegistry()
): Promise<PreparedJobSnapshot> {
  const parsed = parseCanonicalResourceKey(job.resourceKey);
  if (!parsed || parsed.type !== job.type) {
    throw new PermanentJobError("Invalid canonical job resource", {
      code: "invalid_input",
    });
  }

  const worker = workerForType(registry, job.type);
  const snapshot = await worker.fetch(parsed.identifier);
  const fetchedAt = new Date();

  return {
    persist: (transaction) =>
      worker.persist(transaction, snapshot, {
        identifier: parsed.identifier,
        fetchedAt,
      }),
  };
}

export function createDefaultWorkerRegistry(): JobWorkerRegistry {
  return {
    profile: {
      fetch: scrapeProfile,
      persist: persistProfileSnapshot,
    },
    watchlist: {
      fetch: scrapeUserWatchlist,
      persist: (transaction, snapshot) =>
        persistFilmGridSnapshot(transaction, snapshot, "watchlist"),
    },
    watched: {
      fetch: scrapeUserWatched,
      persist: (transaction, snapshot) =>
        persistFilmGridSnapshot(transaction, snapshot, "watched"),
    },
    network: {
      fetch: scrapeMemberNetwork,
      persist: persistNetworkSnapshot,
    },
    movie: {
      fetch: fetchMovieSnapshot,
      persist: persistMovieSnapshot,
    },
  };
}

async function fetchMovieSnapshot(
  identifier: string
): Promise<MovieEnrichmentResult> {
  const { prisma } = await import("@/lib/prisma");
  const existing = await prisma.movie.findUnique({
    where: { letterboxdSlug: identifier },
    select: {
      title: true,
      year: true,
      letterboxdFilmId: true,
      tmdbId: true,
      letterboxdPosterUrls: true,
    },
  });

  return enrichMovie({
    letterboxdSlug: identifier,
    sourceTitle: existing?.title,
    sourceYear: existing?.year,
    letterboxdFilmId: existing?.letterboxdFilmId,
    directTmdbId: existing?.tmdbId,
    letterboxdPosterUrls: existing?.letterboxdPosterUrls,
  });
}

async function persistProfileSnapshot(
  transaction: PersistenceTransaction,
  profile: ProfileInfo,
  context: { identifier: string; fetchedAt: Date }
): Promise<void> {
  await transaction.letterboxdUser.upsert({
    where: { username: context.identifier },
    create: {
      username: context.identifier,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      profileFetchedAt: context.fetchedAt,
      profileStaleAt: computeStaleAt("profile", context.fetchedAt),
    },
    update: {
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      profileFetchedAt: context.fetchedAt,
      profileStaleAt: computeStaleAt("profile", context.fetchedAt),
    },
  });
}

async function persistFilmGridSnapshot(
  transaction: PersistenceTransaction,
  snapshot: ScrapeResult | WatchedScrapeResult,
  kind: "watchlist" | "watched"
): Promise<void> {
  const fetchedAt = snapshot.fetchedAt;
  const user = await transaction.letterboxdUser.upsert({
    where: { username: snapshot.username },
    create: {
      username: snapshot.username,
      displayName: snapshot.displayName,
      avatarUrl: snapshot.avatarUrl,
      ...(kind === "watchlist"
        ? {
            watchlistFetchedAt: fetchedAt,
            watchlistStaleAt: computeStaleAt("watchlist", fetchedAt),
          }
        : {
            watchedFetchedAt: fetchedAt,
            watchedStaleAt: computeStaleAt("watched", fetchedAt),
          }),
    },
    update: {
      displayName: snapshot.displayName,
      avatarUrl: snapshot.avatarUrl,
      ...(kind === "watchlist"
        ? {
            watchlistFetchedAt: fetchedAt,
            watchlistStaleAt: computeStaleAt("watchlist", fetchedAt),
          }
        : {
            watchedFetchedAt: fetchedAt,
            watchedStaleAt: computeStaleAt("watched", fetchedAt),
          }),
    },
  });

  const items = await materializeMovies(transaction, snapshot.items);
  if (kind === "watchlist") {
    await transaction.watchlistItem.deleteMany({ where: { userId: user.id } });
    if (items.length > 0) {
      await transaction.watchlistItem.createMany({
        data: items.map(({ item, movieId }) => ({
          userId: user.id,
          movieId,
          position: item.position,
          sourceTitle: item.sourceTitle,
          sourceSlug: item.sourceSlug,
          sourceYear: item.sourceYear,
          resolutionStatus: databaseResolutionStatus(item.resolutionStatus),
        })),
      });
    }
  } else {
    await transaction.watchedItem.deleteMany({ where: { userId: user.id } });
    if (items.length > 0) {
      await transaction.watchedItem.createMany({
        data: items.map(({ item, movieId }) => ({
          userId: user.id,
          movieId,
          position: item.position,
          sourceTitle: item.sourceTitle,
          sourceSlug: item.sourceSlug,
          sourceYear: item.sourceYear,
          resolutionStatus: databaseResolutionStatus(item.resolutionStatus),
        })),
      });
    }
  }
}

async function materializeMovies(
  transaction: PersistenceTransaction,
  items: LetterboxdFilmGridItem[]
): Promise<Array<{ item: LetterboxdFilmGridItem; movieId: bigint }>> {
  if (items.length > MAX_FILM_SNAPSHOT_ITEMS) {
    throw new PermanentJobError("Film snapshot exceeded the persistence limit", {
      code: "parse_error",
    });
  }

  const idsBySlug = new Map<string, bigint>();
  for (const batch of chunks(items, PERSISTENCE_BATCH_SIZE)) {
    const payload = JSON.stringify(
      batch.map((item) => ({
        slug: item.sourceSlug,
        letterboxdFilmId: item.letterboxdFilmId,
        title: item.sourceTitle,
        year: item.sourceYear,
        posterUrls: item.letterboxdPosterUrls,
      }))
    );

    // One parameterized UPSERT per batch replaces one network round trip per
    // film while preserving any TMDB enrichment already stored on the row.
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "Movie" (
        "letterboxdSlug",
        "letterboxdFilmId",
        "title",
        "year",
        "letterboxdPosterUrls",
        "resolutionStatus",
        "updatedAt"
      )
      SELECT
        source.slug,
        source."letterboxdFilmId",
        source.title,
        source.year,
        ARRAY(
          SELECT jsonb_array_elements_text(source."posterUrls")
        ),
        'pending'::"MovieResolutionStatus",
        CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${payload}::jsonb) AS source(
        slug text,
        "letterboxdFilmId" integer,
        title text,
        year integer,
        "posterUrls" jsonb
      )
      ON CONFLICT ("letterboxdSlug") DO UPDATE SET
        "letterboxdFilmId" = COALESCE(
          EXCLUDED."letterboxdFilmId",
          "Movie"."letterboxdFilmId"
        ),
        "title" = EXCLUDED."title",
        "year" = EXCLUDED."year",
        "letterboxdPosterUrls" = EXCLUDED."letterboxdPosterUrls",
        "updatedAt" = CURRENT_TIMESTAMP
    `);

    const movies = await transaction.movie.findMany({
      where: { letterboxdSlug: { in: batch.map((item) => item.sourceSlug) } },
      select: { id: true, letterboxdSlug: true },
    });
    for (const movie of movies) idsBySlug.set(movie.letterboxdSlug, movie.id);
  }

  return items.map((item) => {
    const movieId = idsBySlug.get(item.sourceSlug);
    if (movieId === undefined) {
      throw new Error(`Movie upsert did not return ${item.sourceSlug}`);
    }
    return { item, movieId };
  });
}

async function persistNetworkSnapshot(
  transaction: PersistenceTransaction,
  snapshot: NetworkScrapeResult,
  context: { fetchedAt: Date }
): Promise<void> {
  const owner = await transaction.letterboxdUser.upsert({
    where: { username: snapshot.username },
    create: {
      username: snapshot.username,
      networkFetchedAt: context.fetchedAt,
      networkStaleAt: computeStaleAt("network", context.fetchedAt),
    },
    update: {
      networkFetchedAt: context.fetchedAt,
      networkStaleAt: computeStaleAt("network", context.fetchedAt),
    },
  });

  const members = [...snapshot.mutuals, ...snapshot.following];
  if (members.length > MAX_NETWORK_SNAPSHOT_MEMBERS) {
    throw new PermanentJobError("Network snapshot exceeded the persistence limit", {
      code: "parse_error",
    });
  }

  const memberIds = await materializeNetworkMembers(transaction, members);
  const edges: Array<{
    memberId: bigint;
    relationship: "MUTUAL" | "FOLLOWING";
    position: number;
    displayName?: string;
    avatarUrl?: string;
  }> = [];
  for (const [relationship, members] of [
    ["MUTUAL", snapshot.mutuals],
    ["FOLLOWING", snapshot.following],
  ] as const) {
    for (const [position, member] of members.entries()) {
      const memberId = memberIds.get(member.username);
      if (memberId === undefined) {
        throw new Error(`Network member upsert did not return ${member.username}`);
      }
      edges.push({
        memberId,
        relationship,
        position,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
      });
    }
  }

  await transaction.networkEdge.deleteMany({ where: { ownerId: owner.id } });
  if (edges.length > 0) {
    await transaction.networkEdge.createMany({
      data: edges.map((edge) => ({ ...edge, ownerId: owner.id })),
    });
  }
}

async function materializeNetworkMembers(
  transaction: PersistenceTransaction,
  members: NetworkScrapeResult["mutuals"]
): Promise<Map<string, bigint>> {
  const ids = new Map<string, bigint>();
  for (const batch of chunks(members, PERSISTENCE_BATCH_SIZE)) {
    const byUsername = new Map(batch.map((member) => [member.username, member]));
    const payload = JSON.stringify([...byUsername.values()]);
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "LetterboxdUser" (
        "username",
        "displayName",
        "avatarUrl",
        "updatedAt"
      )
      SELECT
        source.username,
        source."displayName",
        source."avatarUrl",
        CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${payload}::jsonb) AS source(
        username text,
        "displayName" text,
        "avatarUrl" text
      )
      ON CONFLICT ("username") DO UPDATE SET
        "displayName" = EXCLUDED."displayName",
        "avatarUrl" = EXCLUDED."avatarUrl",
        "updatedAt" = CURRENT_TIMESTAMP
    `);
    const rows = await transaction.letterboxdUser.findMany({
      where: { username: { in: [...byUsername.keys()] } },
      select: { id: true, username: true },
    });
    for (const row of rows) ids.set(row.username, row.id);
  }
  return ids;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

async function persistMovieSnapshot(
  transaction: PersistenceTransaction,
  movie: MovieEnrichmentResult
): Promise<void> {
  const data = {
    letterboxdFilmId: movie.letterboxdFilmId,
    tmdbId: movie.tmdbId,
    resolutionStatus: databaseResolutionStatus(movie.resolutionStatus),
    title: movie.title,
    year: movie.year,
    tmdbTitle: movie.tmdbTitle,
    tmdbOriginalTitle: movie.originalTitle,
    tmdbOverview: movie.overview,
    tmdbReleaseDate: movie.releaseDate
      ? new Date(`${movie.releaseDate}T00:00:00.000Z`)
      : null,
    tmdbRuntimeMinutes: movie.runtimeMinutes,
    tmdbGenres: movie.genres,
    tmdbVoteAverage: movie.tmdbVoteAverage,
    tmdbPosterPath: movie.tmdbPosterPath,
    tmdbBackdropPath: movie.tmdbBackdropPath,
    letterboxdPosterUrls: movie.letterboxdPosterUrls,
    letterboxdRating: movie.letterboxdRating,
    tmdbFetchedAt: movie.tmdbFetchedAt,
    tmdbStaleAt: movie.tmdbStaleAt,
    letterboxdFetchedAt: movie.letterboxdFetchedAt,
    letterboxdStaleAt: movie.letterboxdStaleAt,
  };
  await transaction.movie.upsert({
    where: { letterboxdSlug: movie.letterboxdSlug },
    create: { letterboxdSlug: movie.letterboxdSlug, ...data },
    update: data,
  });
}

function databaseResolutionStatus(
  status: "pending" | "resolved" | "unresolved" | "ambiguous"
): "PENDING" | "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS" {
  return status.toUpperCase() as
    | "PENDING"
    | "RESOLVED"
    | "UNRESOLVED"
    | "AMBIGUOUS";
}

function workerForType(
  registry: JobWorkerRegistry,
  type: JobType
): SnapshotJobWorker<unknown> {
  return registry[type] as SnapshotJobWorker<unknown>;
}
