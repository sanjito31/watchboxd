"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AddMemberForm } from "./AddMemberForm";
import { PartyRoster } from "./PartyRoster";
import { FilmList } from "./FilmList";
import { FriendSuggestions } from "./FriendSuggestions";
import { OverlapPagination } from "./OverlapPagination";
import { useWatchParty } from "@/lib/hooks/useWatchParty";
import {
  computeRankedOverlap,
  MIN_OVERLAP_COUNT,
  paginate,
} from "@/lib/intersection";
import { parseUsername } from "@/lib/letterboxd/parseUsername";
import { OVERLAP_PAGE_SIZE } from "@/lib/ui-constants";
import type {
  Film,
  NetworkResponse,
  UserNetworkState,
  UserWatchlist,
  WatchlistResponse,
} from "@/lib/types";

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

  const [watchlists, setWatchlists] = useState<Map<string, UserWatchlist>>(
    new Map()
  );
  const [hasFetched, setHasFetched] = useState(false);
  const [overlapPage, setOverlapPage] = useState(1);
  const [copyOk, setCopyOk] = useState(false);
  const [suggestionsSource, setSuggestionsSource] = useState<string | null>(
    null
  );
  const [networkByUser, setNetworkByUser] = useState<
    Map<string, UserNetworkState>
  >(new Map());

  const fetchNetwork = useCallback(async (username: string) => {
    setNetworkByUser((prev) => {
      const next = new Map(prev);
      next.set(username, {
        loading: true,
        mutuals: [],
        following: [],
      });
      return next;
    });

    try {
      const res = await fetch(
        `/api/network/${encodeURIComponent(username)}`
      );
      const data = (await res.json()) as NetworkResponse & { error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load network");
      }

      setNetworkByUser((prev) => {
        const next = new Map(prev);
        next.set(username, {
          loading: false,
          mutuals: data.mutuals,
          following: data.following,
          truncated: data.truncated,
        });
        return next;
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load network";
      setNetworkByUser((prev) => {
        const next = new Map(prev);
        next.set(username, {
          loading: false,
          mutuals: [],
          following: [],
          error: message,
        });
        return next;
      });
    }
  }, []);

  const selectSuggestionsSource = useCallback(
    (username: string) => {
      setSuggestionsSource(username);
      setNetworkByUser((prev) => {
        const existing = prev.get(username);
        if (existing?.loading) return prev;
        if (existing && !existing.error) return prev;
        void fetchNetwork(username);
        return prev;
      });
    },
    [fetchNetwork]
  );

  const handleAddMember = useCallback(
    (input: string) => {
      const err = addMember(input);
      if (!err) {
        const username = parseUsername(input);
        if (username) {
          selectSuggestionsSource(username);
        }
      }
      return err;
    },
    [addMember, selectSuggestionsSource]
  );

  const handleAddSuggestion = useCallback(
    (username: string) => addMember(username),
    [addMember]
  );

  const fetchWatchlists = useCallback(async () => {
    if (members.length === 0) return;

    setHasFetched(true);
    const usernames = members.map((m) => m.username);

    setWatchlists((prev) => {
      const next = new Map(prev);
      for (const u of usernames) {
        const existing = next.get(u);
        next.set(u, {
          member: members.find((m) => m.username === u)!,
          films: existing?.films ?? [],
          loading: true,
          error: undefined,
        });
      }
      return next;
    });

    await Promise.all(
      usernames.map(async (username) => {
        try {
          const res = await fetch(`/api/watchlist/${encodeURIComponent(username)}`);
          const data = (await res.json()) as WatchlistResponse & {
            error?: string;
          };

          if (!res.ok) {
            throw new Error(data.error ?? "Failed to load watchlist");
          }

          updateMember(username, {
            displayName: data.displayName,
            avatarUrl: data.avatarUrl,
          });

          setWatchlists((prev) => {
            const next = new Map(prev);
            next.set(username, {
              member: {
                username,
                displayName: data.displayName,
                avatarUrl: data.avatarUrl,
              },
              films: data.films,
              loading: false,
            });
            return next;
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to load watchlist";
          setWatchlists((prev) => {
            const next = new Map(prev);
            next.set(username, {
              member: members.find((m) => m.username === username)!,
              films: [],
              loading: false,
              error: message,
            });
            return next;
          });
        }
      })
    );
  }, [members, updateMember]);

  const handleRemoveMember = useCallback(
    (username: string) => {
      const remaining = members.filter((m) => m.username !== username);
      removeMember(username);
      setWatchlists((prev) => {
        const next = new Map(prev);
        next.delete(username);
        return next;
      });
      if (suggestionsSource === username) {
        setSuggestionsSource(remaining[0]?.username ?? null);
      }
    },
    [removeMember, suggestionsSource, members]
  );

  const allWatchlistsReady = useMemo(
    () =>
      members.length > 0 &&
      members.every((m) => {
        const wl = watchlists.get(m.username);
        return wl && !wl.loading && !wl.error;
      }),
    [members, watchlists]
  );

  const filmMaps = useMemo(() => {
    const map = new Map<string, Film[]>();
    for (const m of members) {
      const wl = watchlists.get(m.username);
      if (wl && !wl.loading && !wl.error) {
        map.set(m.username, wl.films);
      }
    }
    return map;
  }, [members, watchlists]);

  const enrichedMembers = useMemo(
    () =>
      members.map((m) => {
        const wl = watchlists.get(m.username);
        return wl?.member ?? m;
      }),
    [members, watchlists]
  );

  const allRankedOverlap = useMemo(() => {
    if (!hasFetched || !allWatchlistsReady) return [];
    if (members.length < MIN_OVERLAP_COUNT) return [];

    return computeRankedOverlap(filmMaps, enrichedMembers);
  }, [hasFetched, allWatchlistsReady, filmMaps, enrichedMembers, members.length]);

  const overlapPageData = useMemo(
    () => paginate(allRankedOverlap, overlapPage, OVERLAP_PAGE_SIZE),
    [allRankedOverlap, overlapPage]
  );

  const memberKey = members.map((m) => m.username).join(",");

  useEffect(() => {
    setOverlapPage(1);
  }, [memberKey, hasFetched]);

  const isLoading = [...watchlists.values()].some((w) => w.loading);
  const loadErrors = [...watchlists.entries()].filter(([, w]) => w.error);

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

  const activeNetwork = suggestionsSource
    ? networkByUser.get(suggestionsSource)
    : undefined;

  async function handleCopyLink() {
    const ok = await copyShareLink();
    setCopyOk(ok);
    if (ok) setTimeout(() => setCopyOk(false), 2000);
  }

  function handleClearParty() {
    clearParty();
    setWatchlists(new Map());
    setNetworkByUser(new Map());
    setSuggestionsSource(null);
    setHasFetched(false);
    setOverlapPage(1);
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
        <AddMemberForm onAdd={handleAddMember} disabled={isLoading} />
        <PartyRoster
          members={enrichedMembers}
          watchlists={watchlists}
          suggestionsSource={suggestionsSource}
          onSelectForSuggestions={selectSuggestionsSource}
          onRemove={handleRemoveMember}
        />
        {suggestionsMember && suggestionsSource && (
          <FriendSuggestions
            sourceMember={suggestionsMember}
            mutuals={activeNetwork?.mutuals ?? []}
            following={activeNetwork?.following ?? []}
            loading={!activeNetwork || activeNetwork.loading}
            error={activeNetwork?.error}
            truncated={activeNetwork?.truncated}
            partyUsernames={partyUsernames}
            onAdd={handleAddSuggestion}
            partyFull={members.length >= maxPartySize}
          />
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void fetchWatchlists()}
            disabled={members.length === 0 || isLoading}
            className="rounded-lg bg-lb-green px-5 py-2.5 font-medium text-lb-white transition hover:bg-lb-green-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Fetching watchlists…" : "Find overlap"}
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

      {loadErrors.length > 0 && (
        <div
          className="rounded-lg border border-lb-star/40 bg-lb-charcoal px-4 py-3 text-sm text-lb-star"
          role="alert"
        >
          <p className="font-medium">Could not load some watchlists:</p>
          <ul className="mt-1 list-inside list-disc">
            {loadErrors.map(([user, wl]) => (
              <li key={user}>
                @{user}: {wl.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasFetched && members.length > 0 && !isLoading && loadErrors.length === 0 && (
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
          ) : (
            <>
              <OverlapPagination
                page={overlapPageData.page}
                totalPages={overlapPageData.totalPages}
                total={overlapPageData.total}
                showing={overlapPageData.items.length}
                onPageChange={setOverlapPage}
              />
              <FilmList films={overlapPageData.items} />
            </>
          )}
        </section>
      )}
    </div>
  );
}
