import type {
  ApiCacheMeta,
  ApiJobSummary,
  NetworkMemberDto,
  OverlapFilmDto,
} from "@/lib/api/contracts";

export interface PartyMember {
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export type NetworkMember = NetworkMemberDto;
export type OverlapFilm = OverlapFilmDto;

export type AsyncResourceStatus =
  | "idle"
  | "loading"
  | "pending"
  | "success"
  | "error";

export interface MemberLoadState {
  status: "idle" | "loading" | "pending" | "success" | "error";
  label?: string;
}

export interface UiResourceState<T> {
  status: AsyncResourceStatus;
  data?: T;
  meta?: ApiCacheMeta;
  jobs: ApiJobSummary[];
  error?: import("./v1-client").V1ApiError;
}
