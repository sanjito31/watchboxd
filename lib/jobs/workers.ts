import { randomUUID } from "node:crypto";
import { computeStaleAt } from "@/lib/cache/policy";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  movieScrapeResultFromPage,
  resolveLetterboxdMovieByTmdbId,
  scrapeLetterboxdMovie,
  scrapeMemberNetwork,
  scrapeProfile,
  scrapeUserWatched,
  scrapeUserWatchlist,
  type LetterboxdFilmGridItem,
  type LetterboxdFilmGridResult,
  type MovieScrapeResult,
  type NetworkScrapeResult,
  type ProfileInfo,
} from "@/lib/letterboxd";
import { LETTERBOXD_BASE } from "@/lib/letterboxd/constants";
import { parseMovieJobIdentifier } from "@/lib/movies/jobIdentifier";
import {
  buildCanonicalResourceKey,
  parseCanonicalResourceKey,
  PermanentJobError,
  type JobEnvironment,
  type JobType,
} from "./contracts";
import { fromDatabaseJob, type JobRecord } from "./repository";

export type PersistenceTransaction = Prisma.TransactionClient;

const PERSISTENCE_BATCH_SIZE = 100;
const MAX_FILM_SNAPSHOT_ITEMS = 5_000;
const MAX_NETWORK_SNAPSHOT_MEMBERS = 1_500;

export interface SnapshotJobWorker<TSnapshot> {
  fetch(identifier: string): Promise<TSnapshot>;
  persist(
    transaction: PersistenceTransaction,
    snapshot: TSnapshot,
    context: {
      identifier: string;
      environment: JobEnvironment;
      fetchedAt: Date;
    }
  ): Promise<JobRecord[] | void>;
}

export interface JobWorkerRegistry {
  profile: SnapshotJobWorker<ProfileInfo>;
  watchlist: SnapshotJobWorker<LetterboxdFilmGridResult>;
  watched: SnapshotJobWorker<LetterboxdFilmGridResult>;
  network: SnapshotJobWorker<NetworkScrapeResult>;
  movie: SnapshotJobWorker<MovieScrapeResult>;
}

export interface PreparedJobSnapshot {
  persist(transaction: PersistenceTransaction): Promise<JobRecord[] | void>;
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
        environment: job.environment,
        fetchedAt,
      }),
  };
}

export function createDefaultWorkerRegistry(): JobWorkerRegistry {
  return {
    profile: { fetch: scrapeProfile, persist: persistProfileSnapshot },
    watchlist: {
      fetch: scrapeUserWatchlist,
      persist: (transaction, snapshot, context) =>
        persistFilmGridSnapshot(transaction, snapshot, "watchlist", context),
    },
    watched: {
      fetch: scrapeUserWatched,
      persist: (transaction, snapshot, context) =>
        persistFilmGridSnapshot(transaction, snapshot, "watched", context),
    },
    network: { fetch: scrapeMemberNetwork, persist: persistNetworkSnapshot },
    movie: { fetch: fetchMovieSnapshot, persist: persistMovieSnapshot },
  };
}

async function fetchMovieSnapshot(identifier: string): Promise<MovieScrapeResult> {
  const { prisma } = await import("@/lib/prisma");
  const parsed = parseMovieJobIdentifier(identifier);
  const existing = await prisma.movie.findFirst({
    where:
      parsed.kind === "tmdb"
        ? { tmdbId: parsed.tmdbId }
        : {
            OR: [
              { letterboxdSlug: parsed.letterboxdSlug },
              { aliases: { some: { slug: parsed.letterboxdSlug } } },
            ],
          },
    select: {
      letterboxdSlug: true,
      title: true,
      year: true,
      tmdbId: true,
      letterboxdPoster: true,
    },
  });

  if (parsed.kind === "tmdb" && !existing) {
    const resolved = await resolveLetterboxdMovieByTmdbId(parsed.tmdbId);
    return movieScrapeResultFromPage(
      { letterboxdSlug: resolved.letterboxdSlug, knownTmdbId: parsed.tmdbId },
      {
        html: resolved.html,
        url: `${LETTERBOXD_BASE}/film/${resolved.letterboxdSlug}/`,
      }
    );
  }

  const slug =
    existing?.letterboxdSlug ??
    (parsed.kind === "letterboxd" ? parsed.letterboxdSlug : identifier);
  return scrapeLetterboxdMovie({
    letterboxdSlug: slug,
    fallbackTitle: existing?.title,
    fallbackYear: existing?.year,
    fallbackPoster: existing?.letterboxdPoster,
    knownTmdbId:
      existing?.tmdbId ?? (parsed.kind === "tmdb" ? parsed.tmdbId : null),
  });
}

async function persistProfileSnapshot(
  transaction: PersistenceTransaction,
  profile: ProfileInfo,
  context: { identifier: string; fetchedAt: Date }
): Promise<JobRecord[]> {
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
  return [];
}

export async function persistFilmGridSnapshot(
  transaction: PersistenceTransaction,
  snapshot: LetterboxdFilmGridResult,
  kind: "watchlist" | "watched",
  context: { environment: JobEnvironment }
): Promise<JobRecord[]> {
  if (snapshot.items.length > MAX_FILM_SNAPSHOT_ITEMS) {
    throw new PermanentJobError("Film snapshot exceeded the persistence limit", {
      code: "parse_error",
    });
  }

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

  const materialized = await materializeMovies(transaction, snapshot.items);
  const relationships = deduplicateRelationships(materialized);
  if (kind === "watchlist") {
    await transaction.watchlistItem.deleteMany({ where: { userId: user.id } });
    if (relationships.length > 0) {
      await transaction.watchlistItem.createMany({
        data: relationships.map(({ movieId, position }) => ({
          userId: user.id,
          movieId,
          position,
        })),
      });
    }
  } else {
    await transaction.watchedItem.deleteMany({ where: { userId: user.id } });
    if (relationships.length > 0) {
      await transaction.watchedItem.createMany({
        data: relationships.map(({ movieId, position }) => ({
          userId: user.id,
          movieId,
          position,
        })),
      });
    }
  }

  return createPendingMovieJobs(
    transaction,
    materialized
      .filter((entry) => entry.resolutionStatus === "PENDING")
      .map((entry) => entry.letterboxdSlug),
    context.environment
  );
}

interface MaterializedMovie {
  movieId: bigint;
  letterboxdSlug: string;
  resolutionStatus: "PENDING" | "RESOLVED" | "FAILED";
  position: number;
}

export async function materializeMovies(
  transaction: PersistenceTransaction,
  items: LetterboxdFilmGridItem[]
): Promise<MaterializedMovie[]> {
  const bySlug = new Map<string, LetterboxdFilmGridItem>();
  for (const item of items) {
    const existing = bySlug.get(item.sourceSlug);
    if (!existing || item.position < existing.position) bySlug.set(item.sourceSlug, item);
  }
  const uniqueItems = [...bySlug.values()];
  const aliases = await transaction.movieAlias.findMany({
    where: { slug: { in: uniqueItems.map((item) => item.sourceSlug) } },
    include: { movie: true },
  });
  const failedAliasMovieIds = [
    ...new Set(
      aliases
        .filter((alias) => alias.movie.resolutionStatus === "FAILED")
        .map((alias) => alias.movieId)
    ),
  ];
  if (failedAliasMovieIds.length > 0) {
    await transaction.movie.updateMany({
      where: { id: { in: failedAliasMovieIds }, resolutionStatus: "FAILED" },
      data: { resolutionStatus: "PENDING" },
    });
    for (const alias of aliases) {
      if (failedAliasMovieIds.includes(alias.movieId)) {
        alias.movie.resolutionStatus = "PENDING";
      }
    }
  }
  const aliasSlugs = new Set(aliases.map((alias) => alias.slug));
  const directItems = uniqueItems.filter((item) => !aliasSlugs.has(item.sourceSlug));

  for (const batch of chunks(directItems, PERSISTENCE_BATCH_SIZE)) {
    const payload = JSON.stringify(
      batch.map((item) => ({
        slug: item.sourceSlug,
        title: item.sourceTitle,
        year: item.sourceYear,
        poster: item.letterboxdPosterUrls[0] ?? null,
      }))
    );
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "Movie" (
        "letterboxdSlug", "title", "year", "letterboxdPoster",
        "resolutionStatus", "updatedAt"
      )
      SELECT source.slug, source.title, source.year, source.poster,
        'pending'::"MovieResolutionStatus", CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${payload}::jsonb) AS source(
        slug text, title text, year integer, poster text
      )
      ON CONFLICT ("letterboxdSlug") DO UPDATE SET
        "title" = CASE WHEN "Movie"."resolutionStatus" = 'resolved'
          THEN "Movie"."title" ELSE EXCLUDED."title" END,
        "year" = CASE WHEN "Movie"."resolutionStatus" = 'resolved'
          THEN "Movie"."year" ELSE COALESCE(EXCLUDED."year", "Movie"."year") END,
        "letterboxdPoster" = CASE WHEN "Movie"."resolutionStatus" = 'resolved'
          THEN "Movie"."letterboxdPoster"
          ELSE COALESCE(EXCLUDED."letterboxdPoster", "Movie"."letterboxdPoster") END,
        "resolutionStatus" = CASE WHEN "Movie"."resolutionStatus" = 'failed'
          THEN 'pending'::"MovieResolutionStatus"
          ELSE "Movie"."resolutionStatus" END,
        "updatedAt" = CURRENT_TIMESTAMP
    `);
  }

  const directMovies = await transaction.movie.findMany({
    where: { letterboxdSlug: { in: directItems.map((item) => item.sourceSlug) } },
  });
  const byRequestedSlug = new Map(
    directMovies.map((movie) => [movie.letterboxdSlug, movie])
  );
  for (const alias of aliases) byRequestedSlug.set(alias.slug, alias.movie);

  return items.map((item) => {
    const movie = byRequestedSlug.get(item.sourceSlug);
    if (!movie) throw new Error(`Movie upsert did not return ${item.sourceSlug}`);
    return {
      movieId: movie.id,
      letterboxdSlug: movie.letterboxdSlug,
      resolutionStatus: movie.resolutionStatus,
      position: item.position,
    };
  });
}

async function createPendingMovieJobs(
  transaction: PersistenceTransaction,
  slugs: string[],
  environment: JobEnvironment
): Promise<JobRecord[]> {
  const resourceKeys = [...new Set(slugs)].map((slug) =>
    buildCanonicalResourceKey("movie", slug)
  );
  if (resourceKeys.length === 0) return [];
  const now = new Date();
  await transaction.scrapeJob.createMany({
    data: resourceKeys.map((resourceKey) => ({
      id: randomUUID(),
      environment: databaseEnum(environment),
      type: "MOVIE" as const,
      resourceKey,
      updatedAt: now,
    })),
    skipDuplicates: true,
  });
  const jobs = await transaction.scrapeJob.findMany({
    where: {
      environment: databaseEnum(environment),
      type: "MOVIE",
      resourceKey: { in: resourceKeys },
      status: { in: ["QUEUED", "RUNNING"] },
    },
  });
  return jobs
    .map(fromDatabaseJob)
    .filter((job) => job.status === "queued" && job.queueMessageId === null);
}

function deduplicateRelationships(items: MaterializedMovie[]) {
  const byMovie = new Map<bigint, MaterializedMovie>();
  for (const item of items) {
    const existing = byMovie.get(item.movieId);
    if (!existing || item.position < existing.position) byMovie.set(item.movieId, item);
  }
  return [...byMovie.values()].sort((a, b) => a.position - b.position);
}

async function persistNetworkSnapshot(
  transaction: PersistenceTransaction,
  snapshot: NetworkScrapeResult,
  context: { fetchedAt: Date }
): Promise<JobRecord[]> {
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
    ownerId: bigint;
    memberId: bigint;
    relationship: "MUTUAL" | "FOLLOWING";
    position: number;
    displayName?: string;
    avatarUrl?: string;
  }> = [];
  for (const [relationship, group] of [
    ["MUTUAL", snapshot.mutuals],
    ["FOLLOWING", snapshot.following],
  ] as const) {
    for (const [position, member] of group.entries()) {
      const memberId = memberIds.get(member.username);
      if (memberId === undefined) throw new Error(`Missing ${member.username}`);
      edges.push({
        ownerId: owner.id,
        memberId,
        relationship,
        position,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
      });
    }
  }
  await transaction.networkEdge.deleteMany({ where: { ownerId: owner.id } });
  if (edges.length > 0) await transaction.networkEdge.createMany({ data: edges });
  return [];
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
      INSERT INTO "LetterboxdUser" ("username", "displayName", "avatarUrl", "updatedAt")
      SELECT source.username, source."displayName", source."avatarUrl", CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${payload}::jsonb) AS source(
        username text, "displayName" text, "avatarUrl" text
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

export async function persistMovieSnapshot(
  transaction: PersistenceTransaction,
  movie: MovieScrapeResult
): Promise<JobRecord[]> {
  const lockKeys = [
    `slug:${movie.letterboxdSlug}`,
    ...(movie.letterboxdFilmId ? [`film:${movie.letterboxdFilmId}`] : []),
    ...(movie.tmdbId ? [`tmdb:${movie.tmdbId}`] : []),
  ].sort();
  for (const key of lockKeys) {
    // pg_advisory_xact_lock returns PostgreSQL's void pseudo-type. We only
    // need the locking side effect, so do not ask Prisma to deserialize the
    // result as a query row.
    await transaction.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))
    `);
  }

  const identitySlugs = [...new Set([movie.requestedSlug, movie.letterboxdSlug])];
  const candidates = await transaction.movie.findMany({
    where: {
      OR: [
        { letterboxdSlug: { in: identitySlugs } },
        { aliases: { some: { slug: { in: identitySlugs } } } },
        ...(movie.letterboxdFilmId
          ? [{ letterboxdFilmId: movie.letterboxdFilmId }]
          : []),
        ...(movie.tmdbId ? [{ tmdbId: movie.tmdbId }] : []),
      ],
    },
    include: { aliases: true },
  });
  let target =
    candidates.find((row) => row.letterboxdSlug === movie.letterboxdSlug) ??
    candidates.find((row) =>
      row.aliases.some((alias) => alias.slug === movie.letterboxdSlug)
    ) ??
    candidates.find((row) => row.letterboxdSlug === movie.requestedSlug) ??
    candidates[0];

  if (!target) {
    await transaction.movie.create({
      data: {
        ...resolvedMovieData(movie),
      },
    });
    return [];
  }

  const alternateSlugs = new Set(identitySlugs);
  for (const candidate of candidates) {
    alternateSlugs.add(candidate.letterboxdSlug);
    for (const alias of candidate.aliases) alternateSlugs.add(alias.slug);
    if (candidate.id !== target.id) {
      await mergeMovieRelationships(transaction, target.id, candidate.id);
      await transaction.movie.delete({ where: { id: candidate.id } });
    }
  }
  await transaction.movieAlias.deleteMany({ where: { slug: movie.letterboxdSlug } });
  target = await transaction.movie.update({
    where: { id: target.id },
    data: resolvedMovieData(movie),
    include: { aliases: true },
  });
  alternateSlugs.delete(movie.letterboxdSlug);
  if (alternateSlugs.size > 0) {
    await transaction.movieAlias.createMany({
      data: [...alternateSlugs].map((slug) => ({ slug, movieId: target.id })),
      skipDuplicates: true,
    });
  }
  return [];
}

function resolvedMovieData(movie: MovieScrapeResult) {
  return {
    letterboxdSlug: movie.letterboxdSlug,
    title: movie.title,
    year: movie.year,
    letterboxdFilmId: movie.letterboxdFilmId,
    tmdbId: movie.tmdbId,
    letterboxdPoster: movie.letterboxdPoster,
    letterboxdRating: movie.letterboxdRating,
    resolutionStatus: "RESOLVED" as const,
    letterboxdFetchedAt: movie.letterboxdFetchedAt,
    letterboxdStaleAt: movie.letterboxdStaleAt,
  };
}

async function mergeMovieRelationships(
  transaction: PersistenceTransaction,
  targetId: bigint,
  sourceId: bigint
): Promise<void> {
  await mergeRelationshipTable(transaction, "WatchlistItem", targetId, sourceId);
  await mergeRelationshipTable(transaction, "WatchedItem", targetId, sourceId);
}

async function mergeRelationshipTable(
  transaction: PersistenceTransaction,
  table: "WatchlistItem" | "WatchedItem",
  targetId: bigint,
  sourceId: bigint
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)} AS target
      SET "position" = LEAST(target."position", source."position")
      FROM ${Prisma.raw(`"${table}"`)} AS source
      WHERE target."movieId" = ${targetId}
        AND source."movieId" = ${sourceId}
        AND target."userId" = source."userId"`
  );
  await transaction.$executeRaw(
    Prisma.sql`DELETE FROM ${Prisma.raw(`"${table}"`)} AS source
      WHERE source."movieId" = ${sourceId}
        AND EXISTS (
          SELECT 1 FROM ${Prisma.raw(`"${table}"`)} AS target
          WHERE target."movieId" = ${targetId}
            AND target."userId" = source."userId"
        )`
  );
  await transaction.$executeRaw(
    Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)} SET "movieId" = ${targetId}
      WHERE "movieId" = ${sourceId}`
  );
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

function databaseEnum<T extends string>(value: T): Uppercase<T> {
  return value.toUpperCase() as Uppercase<T>;
}

function workerForType(
  registry: JobWorkerRegistry,
  type: JobType
): SnapshotJobWorker<unknown> {
  return registry[type] as SnapshotJobWorker<unknown>;
}
