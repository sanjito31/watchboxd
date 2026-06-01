export interface Film {
  slug: string;
  title: string;
  year?: number;
  url: string;
  posterUrl?: string;
  /** Alternate CDN URLs to try if posterUrl fails in the browser. */
  posterUrls?: string[];
}

export interface PartyMember {
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface WatchlistResponse {
  username: string;
  displayName?: string;
  avatarUrl?: string;
  films: Film[];
  filmCount: number;
  fetchedAt: string;
}

export interface UserWatchlist {
  member: PartyMember;
  films: Film[];
  loading: boolean;
  error?: string;
}

export interface OverlapFilm extends Film {
  presentFor: PartyMember[];
  overlapCount: number;
  partySize: number;
}

export interface NetworkMember {
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface NetworkResponse {
  username: string;
  mutuals: NetworkMember[];
  following: NetworkMember[];
  truncated: boolean;
  cached?: boolean;
}

export interface UserNetworkState {
  loading: boolean;
  error?: string;
  mutuals: NetworkMember[];
  following: NetworkMember[];
  truncated?: boolean;
}
