import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { NetworkRelationship } from "@/lib/generated/prisma/enums";
import { MAX_FOLLOWING_NETWORK_PAGES } from "@/lib/letterboxd/constants";
import { prisma } from "@/lib/prisma";
import type {
  ApiRepository,
  ListItemRecord,
  ListQuery,
  MovieFilters,
  MovieRecord,
  NetworkRecord,
  OverlapGroupRecord,
  OverlapPageRecord,
  UserListRecord,
  UserRecord,
  WatchedListItemRecord,
  WatchedListQuery,
  WatchedOverlapGroupRecord,
  WatchedOverlapQuery,
} from "@/lib/api/types";

const LETTERBOXD_NETWORK_PAGE_SIZE = 25;
const metadataInclude = {
  metadata: { include: { genres: { include: { genre: true } } } },
} as const;

export class PrismaApiRepository implements ApiRepository {
  async getUser(username: string): Promise<UserRecord | null> {
    const user = await prisma.letterboxdUser.findUnique({ where: { username } });
    return user ? mapUser(user) : null;
  }

  async getWatchlist(
    username: string,
    query: ListQuery
  ): Promise<UserListRecord | null> {
    const user = await prisma.letterboxdUser.findUnique({ where: { username } });
    if (!user) return null;
    const where = { userId: user.id, movie: buildMovieWhere(query.filters) };
    const total = await prisma.watchlistItem.count({ where });
    const pagination = paginationFor(total, query.page, query.pageSize);
    const include = query.includeMetadata
      ? { movie: { include: metadataInclude } }
      : { movie: true };
    const items = await prisma.watchlistItem.findMany({
      where,
      include,
      orderBy: [{ position: "asc" }, { id: "asc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    });
    return {
      user: mapUser(user),
      items: items.map(mapListItem),
      total,
      pagination,
    };
  }

  async getWatched(
    username: string,
    query: WatchedListQuery
  ): Promise<UserListRecord<WatchedListItemRecord> | null> {
    const user = await prisma.letterboxdUser.findUnique({ where: { username } });
    if (!user) return null;
    const where = {
      userId: user.id,
      movie: buildMovieWhere(query.filters),
      userRating: numericRange(query.userRatingMin, query.userRatingMax),
    };
    const total = await prisma.watchedItem.count({ where });
    const pagination = paginationFor(total, query.page, query.pageSize);
    const include = query.includeMetadata
      ? { movie: { include: metadataInclude } }
      : { movie: true };
    const items = await prisma.watchedItem.findMany({
      where,
      include,
      orderBy: [{ position: "asc" }, { id: "asc" }],
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    });
    return {
      user: mapUser(user),
      items: items.map(mapWatchedListItem),
      total,
      pagination,
    };
  }

  async getNetwork(username: string): Promise<NetworkRecord | null> {
    const user = await prisma.letterboxdUser.findUnique({
      where: { username },
      include: {
        ownedNetworkEdges: {
          include: { member: true },
          orderBy: [{ relationship: "asc" }, { position: "asc" }],
        },
      },
    });
    if (!user) return null;
    const mutuals = user.ownedNetworkEdges
      .filter((edge) => edge.relationship === NetworkRelationship.MUTUAL)
      .map(mapNetworkMember);
    const following = user.ownedNetworkEdges
      .filter((edge) => edge.relationship === NetworkRelationship.FOLLOWING)
      .map(mapNetworkMember);
    return {
      user: mapUser(user),
      data: {
        username: user.username,
        user: profile(user),
        mutuals,
        following,
        truncated:
          user.ownedNetworkEdges.length >=
          MAX_FOLLOWING_NETWORK_PAGES * LETTERBOXD_NETWORK_PAGE_SIZE,
      },
    };
  }

  async getMovieByTmdbId(tmdbId: number): Promise<MovieRecord | null> {
    const movie = await prisma.movie.findUnique({
      where: { tmdbId },
      include: metadataInclude,
    });
    return movie ? mapMovie(movie) : null;
  }

  async getMovieByLetterboxdSlug(slug: string): Promise<MovieRecord | null> {
    const movie = await prisma.movie.findFirst({
      where: {
        OR: [{ letterboxdSlug: slug }, { aliases: { some: { slug } } }],
      },
      include: metadataInclude,
    });
    return movie ? mapMovie(movie) : null;
  }

  async getUsers(usernames: readonly string[]): Promise<UserRecord[]> {
    const users = await prisma.letterboxdUser.findMany({
      where: { username: { in: [...usernames] } },
    });
    return users.map(mapUser);
  }

  async getWatchlistOverlap(
    usernames: readonly string[],
    query: ListQuery
  ): Promise<OverlapPageRecord<OverlapGroupRecord>> {
    const filter = buildMovieFilterSql(query.filters);
    const from = Prisma.sql`
      FROM "WatchlistItem" item
      JOIN "LetterboxdUser" usr ON usr.id = item."userId"
      JOIN "Movie" movie ON movie.id = item."movieId"
      LEFT JOIN "MovieMetadata" metadata ON metadata."movieId" = movie.id
      WHERE usr.username IN (${Prisma.join([...usernames])}) AND ${filter}
      GROUP BY item."movieId"
      HAVING count(*) = ${usernames.length}
    `;
    const [{ total }] = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total
      FROM (SELECT item."movieId" ${from}) candidates
    `;
    const pagination = paginationFor(total ?? 0, query.page, query.pageSize);
    const candidates = await prisma.$queryRaw<CandidateRow[]>`
      SELECT item."movieId", count(*)::int AS "memberCount", min(movie.title) AS title
      ${from}
      ORDER BY "memberCount" DESC, lower(min(movie.title)), item."movieId"
      LIMIT ${pagination.pageSize}
      OFFSET ${(pagination.page - 1) * pagination.pageSize}
    `;
    const movieIds = candidates.map((candidate) => candidate.movieId);
    const [movies, memberships] = await Promise.all([
      loadMovies(movieIds, query.includeMetadata),
      prisma.watchlistItem.findMany({
        where: {
          movieId: { in: movieIds },
          user: { username: { in: [...usernames] } },
        },
        include: { user: true },
      }),
    ]);
    const usernameOrder = new Map(usernames.map((username, index) => [username, index]));
    return {
      groups: candidates.flatMap((candidate) => {
        const movie = movies.get(candidate.movieId);
        if (!movie) return [];
        const presentFor = memberships
          .filter((item) => item.movieId === candidate.movieId)
          .map((item) => profile(item.user))
          .sort(
            (a, b) =>
              (usernameOrder.get(a.username) ?? 0) -
              (usernameOrder.get(b.username) ?? 0)
          );
        return [{ movie, presentFor }];
      }),
      pagination,
    };
  }

  async getWatchedOverlap(
    usernames: readonly string[],
    query: WatchedOverlapQuery
  ): Promise<OverlapPageRecord<WatchedOverlapGroupRecord>> {
    const filter = buildMovieFilterSql(query.filters);
    const rating = buildRatingSql(query);
    const having =
      rating === null
        ? Prisma.empty
        : query.ratingMode === "all"
          ? Prisma.sql`HAVING bool_and(${rating})`
          : Prisma.sql`HAVING bool_or(${rating})`;
    const from = Prisma.sql`
      FROM "WatchedItem" item
      JOIN "LetterboxdUser" usr ON usr.id = item."userId"
      JOIN "Movie" movie ON movie.id = item."movieId"
      LEFT JOIN "MovieMetadata" metadata ON metadata."movieId" = movie.id
      WHERE usr.username IN (${Prisma.join([...usernames])}) AND ${filter}
      GROUP BY item."movieId"
      ${having}
    `;
    const [{ total }] = await prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total
      FROM (SELECT item."movieId" ${from}) candidates
    `;
    const pagination = paginationFor(total ?? 0, query.page, query.pageSize);
    const candidates = await prisma.$queryRaw<CandidateRow[]>`
      SELECT item."movieId", count(*)::int AS "memberCount", min(movie.title) AS title
      ${from}
      ORDER BY "memberCount" DESC, lower(min(movie.title)), item."movieId"
      LIMIT ${pagination.pageSize}
      OFFSET ${(pagination.page - 1) * pagination.pageSize}
    `;
    const movieIds = candidates.map((candidate) => candidate.movieId);
    const [movies, watches] = await Promise.all([
      loadMovies(movieIds, query.includeMetadata),
      prisma.watchedItem.findMany({
        where: {
          movieId: { in: movieIds },
          user: { username: { in: [...usernames] } },
        },
        include: { user: true },
      }),
    ]);
    const usernameOrder = new Map(usernames.map((username, index) => [username, index]));
    return {
      groups: candidates.flatMap((candidate) => {
        const movie = movies.get(candidate.movieId);
        if (!movie) return [];
        const watchedBy = watches
          .filter((item) => item.movieId === candidate.movieId)
          .map((item) => ({ ...profile(item.user), userRating: item.userRating }))
          .sort(
            (a, b) =>
              (usernameOrder.get(a.username) ?? 0) -
              (usernameOrder.get(b.username) ?? 0)
          );
        return [{ movie, watchedBy }];
      }),
      pagination,
    };
  }
}

type CandidateRow = { movieId: bigint; memberCount: number; title: string };

function buildMovieWhere(filters: MovieFilters): Prisma.MovieWhereInput {
  const metadataAnd: Prisma.MovieMetadataWhereInput[] = [];
  if (filters.runtimeMin !== undefined || filters.runtimeMax !== undefined) {
    metadataAnd.push({ runtimeMinutes: numericRange(filters.runtimeMin, filters.runtimeMax) });
  }
  if (filters.releaseDateFrom || filters.releaseDateTo) {
    metadataAnd.push({
      tmdbReleaseDate: { gte: filters.releaseDateFrom, lte: filters.releaseDateTo },
    });
  }
  if (filters.originalLanguage) {
    metadataAnd.push({ originalLanguage: filters.originalLanguage });
  }
  if (filters.tmdbRatingMin !== undefined || filters.tmdbRatingMax !== undefined) {
    metadataAnd.push({
      tmdbVoteAverage: numericRange(filters.tmdbRatingMin, filters.tmdbRatingMax),
    });
  }
  const genreConditions = [
    ...filters.genreIds.map((id) => ({ genre: { id } })),
    ...filters.genreNames.map((name) => ({
      genre: { name: { equals: name, mode: "insensitive" as const } },
    })),
  ];
  if (genreConditions.length > 0) {
    metadataAnd.push(
      filters.genreMode === "all"
        ? { AND: genreConditions.map((condition) => ({ genres: { some: condition } })) }
        : { genres: { some: { OR: genreConditions } } }
    );
  }
  const title = filters.title
    ? {
        OR: [
          { title: { contains: filters.title, mode: "insensitive" as const } },
          {
            metadata: {
              is: {
                OR: [
                  { tmdbTitle: { contains: filters.title, mode: "insensitive" as const } },
                  { originalTitle: { contains: filters.title, mode: "insensitive" as const } },
                ],
              },
            },
          },
        ],
      }
    : {};
  return {
    ...title,
    letterboxdSlug: filters.letterboxdSlug,
    letterboxdFilmId: filters.letterboxdFilmId,
    tmdbId: filters.tmdbId,
    year: filters.year,
    letterboxdRating:
      filters.letterboxdRatingMin !== undefined ||
      filters.letterboxdRatingMax !== undefined
        ? numericRange(filters.letterboxdRatingMin, filters.letterboxdRatingMax)
        : undefined,
    metadata: metadataAnd.length > 0 ? { is: { AND: metadataAnd } } : undefined,
  };
}

function buildMovieFilterSql(filters: MovieFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (filters.title) {
    const pattern = `%${filters.title}%`;
    conditions.push(
      Prisma.sql`(movie.title ILIKE ${pattern} OR metadata."tmdbTitle" ILIKE ${pattern} OR metadata."originalTitle" ILIKE ${pattern})`
    );
  }
  if (filters.year !== undefined) conditions.push(Prisma.sql`movie.year = ${filters.year}`);
  if (filters.letterboxdSlug) {
    conditions.push(Prisma.sql`movie."letterboxdSlug" = ${filters.letterboxdSlug}`);
  }
  if (filters.letterboxdFilmId !== undefined) {
    conditions.push(Prisma.sql`movie."letterboxdFilmId" = ${filters.letterboxdFilmId}`);
  }
  if (filters.tmdbId !== undefined) {
    conditions.push(Prisma.sql`movie."tmdbId" = ${filters.tmdbId}`);
  }
  pushRange(conditions, Prisma.sql`metadata."runtimeMinutes"`, filters.runtimeMin, filters.runtimeMax);
  pushRange(conditions, Prisma.sql`metadata."tmdbReleaseDate"`, filters.releaseDateFrom, filters.releaseDateTo);
  if (filters.originalLanguage) {
    conditions.push(Prisma.sql`lower(metadata."originalLanguage") = ${filters.originalLanguage}`);
  }
  pushRange(conditions, Prisma.sql`metadata."tmdbVoteAverage"`, filters.tmdbRatingMin, filters.tmdbRatingMax);
  pushRange(conditions, Prisma.sql`movie."letterboxdRating"`, filters.letterboxdRatingMin, filters.letterboxdRatingMax);
  const genreConditions = [
    ...filters.genreIds.map((id) => Prisma.sql`genre.id = ${id}`),
    ...filters.genreNames.map((name) => Prisma.sql`lower(genre.name) = ${name}`),
  ];
  if (genreConditions.length > 0) {
    const exists = (condition: Prisma.Sql) => Prisma.sql`
      EXISTS (
        SELECT 1 FROM "MovieGenre" movie_genre
        JOIN "Genre" genre ON genre.id = movie_genre."genreId"
        WHERE movie_genre."movieId" = movie.id AND ${condition}
      )
    `;
    conditions.push(
      filters.genreMode === "all"
        ? Prisma.sql`(${Prisma.join(genreConditions.map(exists), " AND ")})`
        : exists(Prisma.sql`(${Prisma.join(genreConditions, " OR ")})`)
    );
  }
  return conditions.length > 0
    ? Prisma.sql`(${Prisma.join(conditions, " AND ")})`
    : Prisma.sql`TRUE`;
}

function buildRatingSql(query: WatchedOverlapQuery): Prisma.Sql | null {
  if (query.userRatingMin === undefined && query.userRatingMax === undefined) {
    return null;
  }
  const conditions: Prisma.Sql[] = [Prisma.sql`item."userRating" IS NOT NULL`];
  if (query.userRatingMin !== undefined) {
    conditions.push(Prisma.sql`item."userRating" >= ${query.userRatingMin}`);
  }
  if (query.userRatingMax !== undefined) {
    conditions.push(Prisma.sql`item."userRating" <= ${query.userRatingMax}`);
  }
  return Prisma.sql`(${Prisma.join(conditions, " AND ")})`;
}

function pushRange<T extends number | Date>(
  conditions: Prisma.Sql[],
  column: Prisma.Sql,
  min: T | undefined,
  max: T | undefined
): void {
  if (min !== undefined) conditions.push(Prisma.sql`${column} >= ${min}`);
  if (max !== undefined) conditions.push(Prisma.sql`${column} <= ${max}`);
}

function numericRange(
  min: number | undefined,
  max: number | undefined
): { gte?: number; lte?: number } | undefined {
  if (min === undefined && max === undefined) return undefined;
  return { gte: min, lte: max };
}

async function loadMovies(
  movieIds: bigint[],
  includeMetadata: boolean
): Promise<Map<bigint, MovieRecord>> {
  if (movieIds.length === 0) return new Map();
  const include = includeMetadata ? metadataInclude : {};
  const movies = await prisma.movie.findMany({
    where: { id: { in: movieIds } },
    include,
  });
  return new Map(movies.map((movie) => [movie.id, mapMovie(movie)]));
}

function paginationFor(total: number, requestedPage: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(requestedPage, totalPages), pageSize, total, totalPages };
}

function mapUser(user: {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileFetchedAt: Date | null;
  profileStaleAt: Date | null;
  watchlistFetchedAt: Date | null;
  watchlistStaleAt: Date | null;
  watchedFetchedAt: Date | null;
  watchedStaleAt: Date | null;
  networkFetchedAt: Date | null;
  networkStaleAt: Date | null;
}): UserRecord {
  return {
    ...profile(user),
    profile: { fetchedAt: user.profileFetchedAt, staleAt: user.profileStaleAt },
    watchlist: { fetchedAt: user.watchlistFetchedAt, staleAt: user.watchlistStaleAt },
    watched: { fetchedAt: user.watchedFetchedAt, staleAt: user.watchedStaleAt },
    network: { fetchedAt: user.networkFetchedAt, staleAt: user.networkStaleAt },
  };
}

function profile(user: {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}) {
  return { username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl };
}

function mapListItem(item: {
  position: number;
  movie: Parameters<typeof mapMovie>[0];
}): ListItemRecord {
  return { position: item.position, movie: mapMovie(item.movie) };
}

function mapWatchedListItem(item: {
  position: number;
  userRating: number | null;
  movie: Parameters<typeof mapMovie>[0];
}): WatchedListItemRecord {
  return { position: item.position, userRating: item.userRating, movie: mapMovie(item.movie) };
}

function mapMovie(movie: {
  letterboxdSlug: string;
  letterboxdFilmId: number | null;
  tmdbId: number | null;
  resolutionStatus: string;
  title: string;
  year: number | null;
  letterboxdPoster: string | null;
  letterboxdRating: number | null;
  letterboxdFetchedAt: Date | null;
  letterboxdStaleAt: Date | null;
  metadata?: {
    runtimeMinutes: number | null;
    overview: string | null;
    tmdbTitle: string | null;
    originalTitle: string | null;
    originalLanguage: string | null;
    tmdbReleaseDate: Date | null;
    tmdbVoteAverage: number | null;
    tmdbPosterPath: string | null;
    tmdbBackdropPath: string | null;
    tmdbFetchedAt: Date;
    tmdbStaleAt: Date;
    genres: Array<{ genre: { id: number; name: string } }>;
  } | null;
}): MovieRecord {
  return {
    letterboxdSlug: movie.letterboxdSlug,
    letterboxdFilmId: movie.letterboxdFilmId,
    tmdbId: movie.tmdbId,
    resolutionStatus: movie.resolutionStatus.toLowerCase() as MovieRecord["resolutionStatus"],
    title: movie.title,
    year: movie.year,
    letterboxdPoster: movie.letterboxdPoster,
    letterboxdRating: movie.letterboxdRating,
    letterboxd: { fetchedAt: movie.letterboxdFetchedAt, staleAt: movie.letterboxdStaleAt },
    metadata: movie.metadata
      ? {
          runtimeMinutes: movie.metadata.runtimeMinutes,
          overview: movie.metadata.overview,
          tmdbTitle: movie.metadata.tmdbTitle,
          originalTitle: movie.metadata.originalTitle,
          originalLanguage: movie.metadata.originalLanguage,
          tmdbReleaseDate: movie.metadata.tmdbReleaseDate,
          tmdbVoteAverage: movie.metadata.tmdbVoteAverage,
          tmdbPosterPath: movie.metadata.tmdbPosterPath,
          tmdbBackdropPath: movie.metadata.tmdbBackdropPath,
          fetchedAt: movie.metadata.tmdbFetchedAt,
          staleAt: movie.metadata.tmdbStaleAt,
          genres: movie.metadata.genres
            .map(({ genre }) => genre)
            .sort((a, b) => a.name.localeCompare(b.name)),
        }
      : null,
  };
}

function mapNetworkMember(edge: {
  displayName: string | null;
  avatarUrl: string | null;
  member: { username: string; displayName: string | null; avatarUrl: string | null };
}) {
  return {
    username: edge.member.username,
    displayName: edge.displayName ?? edge.member.displayName,
    avatarUrl: edge.avatarUrl ?? edge.member.avatarUrl,
  };
}
