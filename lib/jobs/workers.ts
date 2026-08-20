import { Prisma } from "@/lib/generated/prisma/client";
import { computeStaleAt } from "@/lib/cache/policy";
import {
  enrichMovie,
  scrapeMemberNetwork,
  scrapeProfile,
  resolveLetterboxdMovieByTmdbId,
  scrapeUserWatched,
  scrapeUserWatchlist,
  type MovieEnrichmentResult,
  type NetworkScrapeResult,
  type ProfileInfo,
  type WatchedScrapeResult,
  type ScrapeResult,
} from "@/lib/letterboxd";
import type { LetterboxdFilmGridItem } from "@/lib/letterboxd/types";
import { parseMovieJobIdentifier } from "@/lib/movies/jobIdentifier";
import { PermanentJobError } from "./contracts";
import { parseCanonicalResourceKey, type JobType } from "./contracts";
import type { JobRecord } from "./repository";

export type PersistenceTransaction = Prisma.TransactionClient;

const PERSISTENCE_BATCH_SIZE = 100;
const MOVIE_ENRICHMENT_CONCURRENCY = 4;
const MAX_FILM_SNAPSHOT_ITEMS = 5_000;
const MAX_NETWORK_SNAPSHOT_MEMBERS = 1_500;

export interface EnrichedFilmGridSnapshot extends ScrapeResult {
  /** Movies fetched from Letterboxd and TMDB before the write transaction. */
  enrichedMovies: MovieEnrichmentResult[];
}

export interface ExistingMovieEnrichmentState {
  letterboxdSlug: string;
  letterboxdFilmId: number | null;
  tmdbId: number | null;
  resolutionStatus: "PENDING" | "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS";
  letterboxdPosterUrls: string[];
  letterboxdStaleAt: Date | null;
  tmdbStaleAt: Date | null;
}

export interface FilmGridEnrichmentOptions {
  findExistingMovies?: (
    slugs: readonly string[]
  ) => Promise<ExistingMovieEnrichmentState[]>;
  enrich?: typeof enrichMovie;
  concurrency?: number;
}

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
  watchlist: SnapshotJobWorker<EnrichedFilmGridSnapshot>;
  watched: SnapshotJobWorker<EnrichedFilmGridSnapshot>;
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
      fetch: async (identifier) =>
        enrichFilmGridSnapshot(await scrapeUserWatchlist(identifier)),
      persist: (transaction, snapshot) =>
        persistFilmGridSnapshot(transaction, snapshot, "watchlist"),
    },
    watched: {
      fetch: async (identifier) =>
        enrichFilmGridSnapshot(await scrapeUserWatched(identifier)),
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

/**
 * Eagerly enriches every new or incomplete Letterboxd movie before a snapshot
 * enters its database transaction. Completed rows retain their independent
 * cache policy and are not refreshed merely because a containing list changed.
 */
export async function enrichFilmGridSnapshot(
  snapshot: ScrapeResult | WatchedScrapeResult,
  options: FilmGridEnrichmentOptions = {}
): Promise<EnrichedFilmGridSnapshot> {
  if (snapshot.items.length > MAX_FILM_SNAPSHOT_ITEMS) {
    throw new PermanentJobError("Film snapshot exceeded the persistence limit", {
      code: "parse_error",
    });
  }

  const findExisting = options.findExistingMovies ?? findExistingMovieStates;
  const existingRows = await findExisting(
    snapshot.items.map((item) => item.sourceSlug)
  );
  const existingBySlug = new Map(
    existingRows.map((movie) => [movie.letterboxdSlug, movie])
  );
  const candidates = snapshot.items.filter((item) =>
    needsMovieEnrichment(existingBySlug.get(item.sourceSlug))
  );
  const enrich = options.enrich ?? enrichMovie;
  const enrichedMovies = await mapWithConcurrency(
    candidates,
    options.concurrency ?? MOVIE_ENRICHMENT_CONCURRENCY,
    (item) => {
      const existing = existingBySlug.get(item.sourceSlug);
      return enrich({
        letterboxdSlug: item.sourceSlug,
        letterboxdFilmId:
          item.letterboxdFilmId ?? existing?.letterboxdFilmId ?? null,
        sourceTitle: item.sourceTitle,
        sourceYear: item.sourceYear,
        directTmdbId: existing?.tmdbId ?? null,
        letterboxdPosterUrls: uniqueStrings([
          ...(existing?.letterboxdPosterUrls ?? []),
          ...item.letterboxdPosterUrls,
        ]),
      });
    }
  );

  return { ...snapshot, enrichedMovies };
}

async function findExistingMovieStates(
  slugs: readonly string[]
): Promise<ExistingMovieEnrichmentState[]> {
  if (slugs.length === 0) return [];
  const { prisma } = await import("@/lib/prisma");
  const rows: ExistingMovieEnrichmentState[] = [];
  for (const batch of chunks(slugs, PERSISTENCE_BATCH_SIZE)) {
    rows.push(
      ...(await prisma.movie.findMany({
        where: { letterboxdSlug: { in: batch } },
        select: {
          letterboxdSlug: true,
          letterboxdFilmId: true,
          tmdbId: true,
          resolutionStatus: true,
          letterboxdPosterUrls: true,
          letterboxdStaleAt: true,
          tmdbStaleAt: true,
        },
      }))
    );
  }
  return rows;
}

function needsMovieEnrichment(
  existing: ExistingMovieEnrichmentState | undefined
): boolean {
  if (
    !existing ||
    existing.resolutionStatus === "PENDING" ||
    (existing.resolutionStatus === "RESOLVED" && existing.tmdbId === null)
  ) {
    return true;
  }
  return (
    existing.letterboxdStaleAt === null ||
    existing.tmdbStaleAt === null
  );
}

async function fetchMovieSnapshot(
  identifier: string
): Promise<MovieEnrichmentResult> {
  const { prisma } = await import("@/lib/prisma");
  const parsedIdentifier = parseMovieJobIdentifier(identifier);
  const existing = await prisma.movie.findUnique({
    where:
      parsedIdentifier.kind === "tmdb"
        ? { tmdbId: parsedIdentifier.tmdbId }
        : { letterboxdSlug: parsedIdentifier.letterboxdSlug },
    select: {
      letterboxdSlug: true,
      title: true,
      year: true,
      letterboxdFilmId: true,
      tmdbId: true,
      letterboxdPosterUrls: true,
    },
  });

  if (parsedIdentifier.kind === "tmdb" && !existing) {
    const resolved = await resolveLetterboxdMovieByTmdbId(
      parsedIdentifier.tmdbId
    );
    return enrichMovie(
      {
        letterboxdSlug: resolved.letterboxdSlug,
        directTmdbId: parsedIdentifier.tmdbId,
      },
      { fetchLetterboxdHtml: async () => resolved.html }
    );
  }

  return enrichMovie({
    letterboxdSlug:
      existing?.letterboxdSlug ??
      (parsedIdentifier.kind === "letterboxd"
        ? parsedIdentifier.letterboxdSlug
        : identifier),
    sourceTitle: existing?.title,
    sourceYear: existing?.year,
    letterboxdFilmId: existing?.letterboxdFilmId,
    directTmdbId:
      existing?.tmdbId ??
      (parsedIdentifier.kind === "tmdb" ? parsedIdentifier.tmdbId : null),
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
  snapshot: EnrichedFilmGridSnapshot,
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

  const items = await materializeMovies(
    transaction,
    snapshot.items,
    snapshot.enrichedMovies
  );
  if (kind === "watchlist") {
    await transaction.watchlistItem.deleteMany({ where: { userId: user.id } });
    if (items.length > 0) {
      await transaction.watchlistItem.createMany({
        data: items.map(({ item, movieId, resolutionStatus }) => ({
          userId: user.id,
          movieId,
          position: item.position,
          sourceTitle: item.sourceTitle,
          sourceSlug: item.sourceSlug,
          sourceYear: item.sourceYear,
          resolutionStatus: databaseResolutionStatus(resolutionStatus),
        })),
      });
    }
  } else {
    await transaction.watchedItem.deleteMany({ where: { userId: user.id } });
    if (items.length > 0) {
      await transaction.watchedItem.createMany({
        data: items.map(({ item, movieId, resolutionStatus }) => ({
          userId: user.id,
          movieId,
          position: item.position,
          sourceTitle: item.sourceTitle,
          sourceSlug: item.sourceSlug,
          sourceYear: item.sourceYear,
          resolutionStatus: databaseResolutionStatus(resolutionStatus),
        })),
      });
    }
  }
}

async function materializeMovies(
  transaction: PersistenceTransaction,
  items: LetterboxdFilmGridItem[],
  enrichedMovies: MovieEnrichmentResult[]
): Promise<
  Array<{
    item: LetterboxdFilmGridItem;
    movieId: bigint;
    resolutionStatus: MovieEnrichmentResult["resolutionStatus"];
  }>
> {
  if (items.length > MAX_FILM_SNAPSHOT_ITEMS) {
    throw new PermanentJobError("Film snapshot exceeded the persistence limit", {
      code: "parse_error",
    });
  }

  const idsBySlug = new Map<string, bigint>();
  const resolutionBySlug = new Map<
    string,
    MovieEnrichmentResult["resolutionStatus"]
  >();
  const enrichmentBySlug = new Map(
    enrichedMovies.map((movie) => [movie.letterboxdSlug, movie])
  );
  for (const batch of chunks(items, PERSISTENCE_BATCH_SIZE)) {
    const payload = JSON.stringify(
      batch.map((item) => {
        const movie = enrichmentBySlug.get(item.sourceSlug);
        return {
          slug: item.sourceSlug,
          letterboxdFilmId:
            movie?.letterboxdFilmId ?? item.letterboxdFilmId,
          tmdbId: movie?.tmdbId ?? null,
          resolutionStatus: movie?.resolutionStatus ?? item.resolutionStatus,
          title: movie?.title ?? item.sourceTitle,
          year: movie?.year ?? item.sourceYear,
          tmdbTitle: movie?.tmdbTitle ?? null,
          tmdbOriginalTitle: movie?.originalTitle ?? null,
          tmdbOverview: movie?.overview ?? null,
          tmdbReleaseDate: movie?.releaseDate ?? null,
          tmdbRuntimeMinutes: movie?.runtimeMinutes ?? null,
          tmdbGenres: movie?.genres ?? [],
          tmdbVoteAverage: movie?.tmdbVoteAverage ?? null,
          tmdbPosterPath: movie?.tmdbPosterPath ?? null,
          tmdbBackdropPath: movie?.tmdbBackdropPath ?? null,
          posterUrls: movie?.letterboxdPosterUrls ?? item.letterboxdPosterUrls,
          letterboxdRating: movie?.letterboxdRating ?? null,
          tmdbFetchedAt: movie?.tmdbFetchedAt?.toISOString() ?? null,
          tmdbStaleAt: movie?.tmdbStaleAt?.toISOString() ?? null,
          letterboxdFetchedAt:
            movie?.letterboxdFetchedAt.toISOString() ?? null,
          letterboxdStaleAt: movie?.letterboxdStaleAt.toISOString() ?? null,
        };
      })
    );

    // One parameterized UPSERT per batch persists eager provider enrichment
    // while preserving existing metadata for fresh movies that were skipped.
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "Movie" (
        "letterboxdSlug",
        "letterboxdFilmId",
        "tmdbId",
        "resolutionStatus",
        "title",
        "year",
        "tmdbTitle",
        "tmdbOriginalTitle",
        "tmdbOverview",
        "tmdbReleaseDate",
        "tmdbRuntimeMinutes",
        "tmdbGenres",
        "tmdbVoteAverage",
        "tmdbPosterPath",
        "tmdbBackdropPath",
        "letterboxdPosterUrls",
        "letterboxdRating",
        "tmdbFetchedAt",
        "tmdbStaleAt",
        "letterboxdFetchedAt",
        "letterboxdStaleAt",
        "updatedAt"
      )
      SELECT
        source.slug,
        source."letterboxdFilmId",
        source."tmdbId",
        source."resolutionStatus"::"MovieResolutionStatus",
        source.title,
        source.year,
        source."tmdbTitle",
        source."tmdbOriginalTitle",
        source."tmdbOverview",
        source."tmdbReleaseDate",
        source."tmdbRuntimeMinutes",
        ARRAY(
          SELECT jsonb_array_elements_text(source."tmdbGenres")
        ),
        source."tmdbVoteAverage",
        source."tmdbPosterPath",
        source."tmdbBackdropPath",
        ARRAY(
          SELECT jsonb_array_elements_text(source."posterUrls")
        ),
        source."letterboxdRating",
        source."tmdbFetchedAt",
        source."tmdbStaleAt",
        source."letterboxdFetchedAt",
        source."letterboxdStaleAt",
        CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(${payload}::jsonb) AS source(
        slug text,
        "letterboxdFilmId" integer,
        "tmdbId" integer,
        "resolutionStatus" text,
        title text,
        year integer,
        "tmdbTitle" text,
        "tmdbOriginalTitle" text,
        "tmdbOverview" text,
        "tmdbReleaseDate" date,
        "tmdbRuntimeMinutes" integer,
        "tmdbGenres" jsonb,
        "tmdbVoteAverage" double precision,
        "tmdbPosterPath" text,
        "tmdbBackdropPath" text,
        "posterUrls" jsonb,
        "letterboxdRating" double precision,
        "tmdbFetchedAt" timestamptz,
        "tmdbStaleAt" timestamptz,
        "letterboxdFetchedAt" timestamptz,
        "letterboxdStaleAt" timestamptz
      )
      ON CONFLICT ("letterboxdSlug") DO UPDATE SET
        "letterboxdFilmId" = COALESCE(
          EXCLUDED."letterboxdFilmId",
          "Movie"."letterboxdFilmId"
        ),
        "title" = EXCLUDED."title",
        "year" = EXCLUDED."year",
        "letterboxdPosterUrls" = EXCLUDED."letterboxdPosterUrls",
        "tmdbId" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbId" ELSE "Movie"."tmdbId" END,
        "resolutionStatus" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."resolutionStatus" ELSE "Movie"."resolutionStatus" END,
        "tmdbTitle" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbTitle" ELSE "Movie"."tmdbTitle" END,
        "tmdbOriginalTitle" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbOriginalTitle" ELSE "Movie"."tmdbOriginalTitle" END,
        "tmdbOverview" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbOverview" ELSE "Movie"."tmdbOverview" END,
        "tmdbReleaseDate" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbReleaseDate" ELSE "Movie"."tmdbReleaseDate" END,
        "tmdbRuntimeMinutes" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbRuntimeMinutes" ELSE "Movie"."tmdbRuntimeMinutes" END,
        "tmdbGenres" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbGenres" ELSE "Movie"."tmdbGenres" END,
        "tmdbVoteAverage" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbVoteAverage" ELSE "Movie"."tmdbVoteAverage" END,
        "tmdbPosterPath" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbPosterPath" ELSE "Movie"."tmdbPosterPath" END,
        "tmdbBackdropPath" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbBackdropPath" ELSE "Movie"."tmdbBackdropPath" END,
        "letterboxdRating" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."letterboxdRating" ELSE "Movie"."letterboxdRating" END,
        "tmdbFetchedAt" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbFetchedAt" ELSE "Movie"."tmdbFetchedAt" END,
        "tmdbStaleAt" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."tmdbStaleAt" ELSE "Movie"."tmdbStaleAt" END,
        "letterboxdFetchedAt" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."letterboxdFetchedAt" ELSE "Movie"."letterboxdFetchedAt" END,
        "letterboxdStaleAt" = CASE WHEN EXCLUDED."letterboxdFetchedAt" IS NOT NULL
          THEN EXCLUDED."letterboxdStaleAt" ELSE "Movie"."letterboxdStaleAt" END,
        "updatedAt" = CURRENT_TIMESTAMP
    `);

    const movies = await transaction.movie.findMany({
      where: { letterboxdSlug: { in: batch.map((item) => item.sourceSlug) } },
      select: { id: true, letterboxdSlug: true, resolutionStatus: true },
    });
    for (const movie of movies) {
      idsBySlug.set(movie.letterboxdSlug, movie.id);
      resolutionBySlug.set(
        movie.letterboxdSlug,
        movie.resolutionStatus.toLowerCase() as MovieEnrichmentResult["resolutionStatus"]
      );
    }
  }

  return items.map((item) => {
    const movieId = idsBySlug.get(item.sourceSlug);
    if (movieId === undefined) {
      throw new Error(`Movie upsert did not return ${item.sourceSlug}`);
    }
    return {
      item,
      movieId,
      resolutionStatus:
        enrichmentBySlug.get(item.sourceSlug)?.resolutionStatus ??
        resolutionBySlug.get(item.sourceSlug) ??
        item.resolutionStatus,
    };
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

async function mapWithConcurrency<T, TResult>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<TResult>
): Promise<TResult[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError("Movie enrichment concurrency must be positive");
  }

  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await map(values[index]!);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
