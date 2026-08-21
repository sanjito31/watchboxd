"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AddMemberForm,
  type AddMemberExternalError,
} from "./AddMemberForm";
import { PartyRoster } from "./PartyRoster";
import { FilmList } from "./FilmList";
import { FriendSuggestions } from "./FriendSuggestions";
import { OverlapPagination } from "./OverlapPagination";
import { useWatchParty } from "@/lib/hooks/useWatchParty";
import { useV1Resource } from "@/lib/hooks/useV1Resource";
import { OVERLAP_PAGE_SIZE } from "@/lib/ui-constants";
import type {
  ApiJobSummary,
  NetworkDto,
  OverlapDto,
  ProfileSummaryDto,
} from "@/lib/api/contracts";
import type {
  AsyncResourceStatus,
  MemberLoadState,
  PartyMember,
} from "@/lib/hooks/ui-types";

const MIN_OVERLAP_COUNT = 2;

interface OverlapRequest {
  users: string[];
  page: number;
}

export function WatchPartyApp() {
  const {
    members,
    addMember,
    removeMember,
    updateMember,
    copyShareLink,
    clearParty,
    maxPartySize,
  } = useWatchParty();

  const [overlapRequest, setOverlapRequest] =
    useState<OverlapRequest | null>(null);
  const [copyOk, setCopyOk] = useState(false);
  const [profileValidationError, setProfileValidationError] =
    useState<AddMemberExternalError | null>(null);
  const [suggestionsSource, setSuggestionsSource] = useState<string | null>(
    null
  );

  const networkUrl = suggestionsSource
    ? `/api/v1/users/${encodeURIComponent(suggestionsSource)}/network`
    : null;
  const network = useV1Resource<NetworkDto>(networkUrl);

  useEffect(() => {
    const profile = network.data?.user;
    if (!profile) return;
    updateMember(profile.username, {
      displayName: profile.displayName ?? undefined,
      avatarUrl: profile.avatarUrl ?? undefined,
    });
  }, [network.data?.user, updateMember]);

  const overlapUrl = useMemo(() => {
    if (!overlapRequest || overlapRequest.users.length < MIN_OVERLAP_COUNT) {
      return null;
    }
    const params = new URLSearchParams({
      users: overlapRequest.users.join(","),
      page: String(overlapRequest.page),
      pageSize: String(OVERLAP_PAGE_SIZE),
    });
    return `/api/v1/overlap?${params.toString()}`;
  }, [overlapRequest]);
  const overlap = useV1Resource<OverlapDto>(overlapUrl);

  const resetOverlap = useCallback(() => {
    setOverlapRequest(null);
  }, []);

  const selectSuggestionsSource = useCallback((username: string) => {
    setSuggestionsSource(username);
  }, []);

  const handleProfileLoaded = useCallback(
    (profile: ProfileSummaryDto) => {
      updateMember(profile.username, {
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      });
    },
    [updateMember]
  );

  const handleProfileNotFound = useCallback(
    (username: string) => {
      removeMember(username);
      resetOverlap();
      setSuggestionsSource((current) =>
        current === username ? null : current
      );
      setProfileValidationError({
        input: username,
        message: `No Letterboxd user was found for @${username}. Check the username and try again.`,
      });
    },
    [removeMember, resetOverlap]
  );

  const profileByUsername = useMemo(
    () => {
      const profiles = overlap.data?.users ?? [];
      const selectedProfile = network.data?.user;
      return new Map(
        [
          ...profiles,
          ...(selectedProfile ? [selectedProfile] : []),
        ].map((profile) => [profile.username, profile])
      );
    },
    [network.data?.user, overlap.data]
  );

  const enrichedMembers = useMemo(
    () =>
      members.map((member) => {
        const profile = profileByUsername.get(member.username);
        return profile ? mergeProfile(member, profile) : member;
      }),
    [members, profileByUsername]
  );

  const handleAddMember = useCallback(
    (input: string) => {
      setProfileValidationError(null);
      const err = addMember(input);
      if (!err) {
        resetOverlap();
        setSuggestionsSource(null);
      }
      return err;
    },
    [addMember, resetOverlap]
  );

  const handleAddSuggestion = useCallback(
    (username: string) => {
      const error = addMember(username);
      if (!error) resetOverlap();
      return error;
    },
    [addMember, resetOverlap]
  );

  const handleRemoveMember = useCallback(
    (username: string) => {
      removeMember(username);
      resetOverlap();
      if (suggestionsSource === username) {
        setSuggestionsSource(null);
      }
    },
    [removeMember, resetOverlap, suggestionsSource]
  );

  const isLoading =
    overlap.status === "loading" || overlap.status === "pending";
  const hasFetched = overlapRequest !== null;

  const partyUsernames = useMemo(
    () => new Set(members.map((m) => m.username)),
    [members]
  );

  const suggestionsMember = useMemo(
    () =>
      suggestionsSource
        ? (enrichedMembers.find((m) => m.username === suggestionsSource) ??
          members.find((m) => m.username === suggestionsSource))
        : undefined,
    [suggestionsSource, enrichedMembers, members]
  );

  const statusByUsername = useMemo(() => {
    const result = new Map<string, MemberLoadState>();
    for (const member of members) {
      result.set(
        member.username,
        memberStatus(member.username, overlap.status, overlap.jobs)
      );
    }
    return result;
  }, [members, overlap.jobs, overlap.status]);

  async function handleCopyLink() {
    const ok = await copyShareLink();
    setCopyOk(ok);
    if (ok) setTimeout(() => setCopyOk(false), 2000);
  }

  function handleClearParty() {
    clearParty();
    setSuggestionsSource(null);
    setProfileValidationError(null);
    resetOverlap();
  }

  function handleFindOverlap() {
    setOverlapRequest({
      users: members.map((member) => member.username),
      page: 1,
    });
  }

  function handlePageChange(page: number) {
    setOverlapRequest((current) => (current ? { ...current, page } : current));
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-lb-white">
          Letterboxd Watch Party
        </h1>
        <p className="text-lb-cloud">
          Add friends, compare watchlists, and find what to watch together. Up
          to {maxPartySize} members · no login required.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-lb-steel">
          Watch party
        </h2>
        <AddMemberForm
          onAdd={handleAddMember}
          disabled={isLoading}
          externalError={profileValidationError}
          onExternalErrorDismiss={() => setProfileValidationError(null)}
        />
        <PartyRoster
          members={enrichedMembers}
          statusByUsername={statusByUsername}
          suggestionsSource={suggestionsSource}
          onSelectForSuggestions={selectSuggestionsSource}
          onProfileLoaded={handleProfileLoaded}
          onProfileNotFound={handleProfileNotFound}
          onRemove={handleRemoveMember}
        />
        {suggestionsMember && suggestionsSource && (
          <FriendSuggestions
            sourceMember={suggestionsMember}
            mutuals={network.data?.mutuals ?? []}
            following={network.data?.following ?? []}
            status={network.status}
            error={network.error?.message}
            recoverable={network.error?.recoverable}
            stale={network.meta?.cache === "stale"}
            truncated={network.data?.truncated}
            partyUsernames={partyUsernames}
            onAdd={handleAddSuggestion}
            onRetry={network.retry}
            partyFull={members.length >= maxPartySize}
          />
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleFindOverlap}
            disabled={members.length === 0 || isLoading}
            className="rounded-lg bg-lb-green px-5 py-2.5 font-medium text-lb-white transition hover:bg-lb-green-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {overlap.status === "pending"
              ? "Preparing watchlists…"
              : overlap.status === "loading"
                ? "Finding overlap…"
                : "Find overlap"}
          </button>
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            disabled={members.length === 0}
            className="rounded-lg border border-lb-ocean bg-lb-charcoal px-5 py-2.5 text-sm font-medium text-lb-dust transition hover:border-lb-ghost hover:bg-lb-shadow disabled:opacity-50"
          >
            {copyOk ? "Link copied!" : "Copy share link"}
          </button>
          {members.length > 0 && (
            <button
              type="button"
              onClick={handleClearParty}
              className="rounded-lg border border-lb-ocean px-5 py-2.5 text-sm font-medium text-lb-cloud transition hover:border-lb-star hover:text-lb-star"
            >
              Start over
            </button>
          )}
        </div>
      </section>

      {overlap.status === "error" && (
        <div
          className="rounded-lg border border-lb-star/40 bg-lb-charcoal px-4 py-3 text-sm text-lb-star"
          role="alert"
        >
          <p className="font-medium">Could not load the overlap.</p>
          <p className="mt-1">{overlap.error?.message}</p>
          {overlap.error?.recoverable && (
            <button
              type="button"
              onClick={overlap.retry}
              className="mt-3 rounded border border-lb-star/50 px-3 py-1.5 text-xs font-medium transition hover:bg-lb-shadow"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {hasFetched && members.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wide text-lb-steel">
              What to watch
            </h2>
            <p className="mt-1 text-sm text-lb-cloud">
              Films on at least two watchlists, ranked by how many of you want
              to see them.
            </p>
          </div>

          {members.length < MIN_OVERLAP_COUNT ? (
            <p className="rounded-xl border border-dashed border-lb-ocean px-6 py-8 text-center text-sm text-lb-cloud">
              Add at least {MIN_OVERLAP_COUNT} members to compare watchlists.
            </p>
          ) : isLoading ? (
            <div
              className="rounded-xl border border-lb-shadow bg-lb-charcoal px-6 py-8 text-center"
              role="status"
              aria-live="polite"
            >
              <p className="font-medium text-lb-porcelain">
                {overlap.status === "pending"
                  ? "Preparing watchlists and movie details…"
                  : "Checking everyone’s watchlists…"}
              </p>
              <p className="mt-1 text-sm text-lb-cloud">
                This can take a few minutes the first time. You can keep this
                page open while the background jobs finish.
              </p>
            </div>
          ) : overlap.status === "success" && overlap.data ? (
            <>
              {overlap.meta?.cache === "stale" && (
                <div
                  className="rounded-lg border border-lb-ocean bg-lb-charcoal px-4 py-3 text-sm text-lb-cloud"
                  role="status"
                >
                  Showing cached results while fresh data is prepared.
                  <button
                    type="button"
                    onClick={overlap.retry}
                    className="ml-2 font-medium text-lb-vivid hover:underline"
                  >
                    Check for updates
                  </button>
                </div>
              )}
              <OverlapPagination
                page={overlap.data.pagination.page}
                totalPages={overlap.data.pagination.totalPages}
                total={overlap.data.pagination.total}
                showing={overlap.data.films.length}
                onPageChange={handlePageChange}
              />
              <FilmList films={overlap.data.films} />
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}

function mergeProfile(
  member: PartyMember,
  profile: ProfileSummaryDto
): PartyMember {
  return {
    ...member,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
  };
}

function memberStatus(
  username: string,
  status: AsyncResourceStatus,
  jobs: ApiJobSummary[]
): MemberLoadState {
  if (status === "loading") return { status, label: "Checking…" };
  if (status === "error") return { status, label: "Retry needed" };
  if (status === "success") return { status, label: "Compared" };
  if (status !== "pending") return { status: "idle" };

  const watchlistJob = jobs.find(
    (job) => job.resourceKey === `watchlist:${username}`
  );
  if (!watchlistJob) {
    return { status: "success", label: "Watchlist ready" };
  }
  return {
    status: "pending",
    label: watchlistJob.status === "running" ? "Scraping…" : "Queued…",
  };
}
