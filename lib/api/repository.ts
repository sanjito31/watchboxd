import "server-only";

import { NetworkRelationship } from "@/lib/generated/prisma/enums";
import { MAX_FOLLOWING_NETWORK_PAGES } from "@/lib/letterboxd/constants";
import { prisma } from "@/lib/prisma";
import type {
  ApiRepository,
  ListItemRecord,
  MovieRecord,
  NetworkRecord,
  UserListRecord,
  UserRecord,
  WatchedListItemRecord,
} from "@/lib/api/types";

const movieInclude = { movie: { include: { metadata: true } } } as const;
const LETTERBOXD_NETWORK_PAGE_SIZE = 25;

export class PrismaApiRepository implements ApiRepository {
  async getUser(username: string): Promise<UserRecord | null> {
    const user = await prisma.letterboxdUser.findUnique({ where: { username } });
    return user ? mapUser(user) : null;
  }

  async getWatchlist(username: string): Promise<UserListRecord | null> {
    const user = await prisma.letterboxdUser.findUnique({
      where: { username },
      include: {
        watchlistItems: { include: movieInclude, orderBy: { position: "asc" } },
      },
    });
    return user
      ? { user: mapUser(user), items: user.watchlistItems.map(mapListItem) }
      : null;
  }

  async getWatched(
    username: string
  ): Promise<UserListRecord<WatchedListItemRecord> | null> {
    const user = await prisma.letterboxdUser.findUnique({
      where: { username },
      include: {
        watchedItems: { include: movieInclude, orderBy: { position: "asc" } },
      },
    });
    return user
      ? {
          user: mapUser(user),
          items: user.watchedItems.map(mapWatchedListItem),
        }
      : null;
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
        user: {
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
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
      include: { metadata: true },
    });
    return movie ? mapMovie(movie) : null;
  }

  async getMovieByLetterboxdSlug(slug: string): Promise<MovieRecord | null> {
    const movie = await prisma.movie.findFirst({
      where: {
        OR: [
          { letterboxdSlug: slug },
          { aliases: { some: { slug } } },
        ],
      },
      include: { metadata: true },
    });
    return movie ? mapMovie(movie) : null;
  }

  async getWatchlists(usernames: readonly string[]): Promise<UserListRecord[]> {
    const users = await prisma.letterboxdUser.findMany({
      where: { username: { in: [...usernames] } },
      include: {
        watchlistItems: { include: movieInclude, orderBy: { position: "asc" } },
      },
    });
    return users.map((user) => ({
      user: mapUser(user),
      items: user.watchlistItems.map(mapListItem),
    }));
  }
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
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    profile: { fetchedAt: user.profileFetchedAt, staleAt: user.profileStaleAt },
    watchlist: {
      fetchedAt: user.watchlistFetchedAt,
      staleAt: user.watchlistStaleAt,
    },
    watched: { fetchedAt: user.watchedFetchedAt, staleAt: user.watchedStaleAt },
    network: { fetchedAt: user.networkFetchedAt, staleAt: user.networkStaleAt },
  };
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
  return {
    position: item.position,
    userRating: item.userRating,
    movie: mapMovie(item.movie),
  };
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
  metadata: {
    tmdbFetchedAt: Date;
    tmdbStaleAt: Date;
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
    letterboxd: {
      fetchedAt: movie.letterboxdFetchedAt,
      staleAt: movie.letterboxdStaleAt,
    },
    metadata: {
      fetchedAt: movie.metadata?.tmdbFetchedAt ?? null,
      staleAt: movie.metadata?.tmdbStaleAt ?? null,
    },
  };
}

function mapNetworkMember(edge: {
  displayName: string | null;
  avatarUrl: string | null;
  member: {
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}) {
  return {
    username: edge.member.username,
    displayName: edge.displayName ?? edge.member.displayName,
    avatarUrl: edge.avatarUrl ?? edge.member.avatarUrl,
  };
}
