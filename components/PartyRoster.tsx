"use client";

import { useEffect } from "react";
import type { ProfileDto, ProfileSummaryDto } from "@/lib/api/contracts";
import type {
  MemberLoadState,
  PartyMember,
} from "@/lib/hooks/ui-types";
import {
  useV1Resource,
  type UseV1ResourceResult,
} from "@/lib/hooks/useV1Resource";
import type { V1ApiErrorCode } from "@/lib/hooks/v1-client";

interface PartyRosterProps {
  members: PartyMember[];
  statusByUsername: Map<string, MemberLoadState>;
  suggestionsSource: string | null;
  onSelectForSuggestions: (username: string) => void;
  onProfileLoaded: (profile: ProfileSummaryDto) => void;
  onProfileNotFound: (username: string) => void;
  onRemove: (username: string) => void;
}

export function PartyRoster({
  members,
  statusByUsername,
  suggestionsSource,
  onSelectForSuggestions,
  onProfileLoaded,
  onProfileNotFound,
  onRemove,
}: PartyRosterProps) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-lb-cloud">
        Add friends by Letterboxd username or profile link to start a watch
        party.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-lb-steel">
        Click a member to browse and add their Letterboxd friends.
      </p>
      <ul className="flex flex-wrap gap-3">
        {members.map((member) => (
          <PartyRosterMember
            key={member.username}
            member={member}
            loadState={statusByUsername.get(member.username)}
            isActive={suggestionsSource === member.username}
            onSelectForSuggestions={onSelectForSuggestions}
            onProfileLoaded={onProfileLoaded}
            onProfileNotFound={onProfileNotFound}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </div>
  );
}

interface PartyRosterMemberProps {
  member: PartyMember;
  loadState?: MemberLoadState;
  isActive: boolean;
  onSelectForSuggestions: (username: string) => void;
  onProfileLoaded: (profile: ProfileSummaryDto) => void;
  onProfileNotFound: (username: string) => void;
  onRemove: (username: string) => void;
}

function PartyRosterMember({
  member,
  loadState,
  isActive,
  onSelectForSuggestions,
  onProfileLoaded,
  onProfileNotFound,
  onRemove,
}: PartyRosterMemberProps) {
  const profile = useV1Resource<ProfileDto>(
    `/api/v1/users/${encodeURIComponent(member.username)}`
  );

  useEffect(() => {
    if (profile.data) onProfileLoaded(profile.data);
  }, [onProfileLoaded, profile.data]);

  useEffect(() => {
    if (isProfileNotFoundError(profile.error?.code)) {
      onProfileNotFound(member.username);
    }
  }, [member.username, onProfileNotFound, profile.error?.code]);

  const resolvedMember = profile.data
    ? {
        ...member,
        displayName: profile.data.displayName,
        avatarUrl: profile.data.avatarUrl,
      }
    : member;
  const profileReady = profile.status === "success";
  const profileFailed = profile.status === "error";
  const status = getProfileStatus(profile) ?? loadState?.label;
  const statusIsError = profileFailed || loadState?.status === "error";

  function handleMemberClick() {
    if (profileFailed) {
      profile.retry();
      return;
    }
    if (profileReady) onSelectForSuggestions(member.username);
  }

  return (
    <li>
      <div
        className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-2 transition ${
          isActive
            ? "border-lb-vivid bg-lb-shadow ring-1 ring-lb-vivid/40"
            : "border-lb-ocean bg-lb-charcoal hover:border-lb-ghost hover:bg-lb-shadow"
        }`}
      >
        <button
          type="button"
          onClick={handleMemberClick}
          disabled={!profileReady && !profileFailed}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-wait"
          aria-pressed={isActive}
          aria-label={
            profileFailed
              ? `Retry profile for ${member.username}`
              : `Browse friends of ${member.username}`
          }
        >
          <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-lb-shadow">
            {resolvedMember.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolvedMember.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-sm font-medium text-lb-mist">
                {member.username.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-lb-porcelain">
              @{member.username}
            </p>
            {status && (
              <p
                className={`text-xs ${
                  statusIsError ? "text-lb-star" : "text-lb-steel"
                }`}
              >
                {status}
              </p>
            )}
          </div>
        </button>
        <button
          type="button"
          onClick={() => onRemove(member.username)}
          className="shrink-0 rounded-full p-1 text-lb-cloud transition hover:bg-lb-midnight hover:text-lb-porcelain"
          aria-label={`Remove ${member.username}`}
        >
          ×
        </button>
      </div>
    </li>
  );
}

function getProfileStatus(
  profile: UseV1ResourceResult<ProfileDto>
): string | undefined {
  if (profile.status === "idle" || profile.status === "loading") {
    return "Loading profile…";
  }
  if (profile.status === "pending") {
    const job = profile.jobs.find((candidate) => candidate.type === "profile");
    return job?.status === "running"
      ? "Scraping profile…"
      : "Profile queued…";
  }
  if (profile.status === "error") return "Retry profile";
  return undefined;
}

export function isProfileNotFoundError(
  code: V1ApiErrorCode | undefined
): boolean {
  return code === "not_found" || code === "resource_not_found";
}
