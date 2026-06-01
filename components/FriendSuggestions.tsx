"use client";

import type { NetworkMember, PartyMember } from "@/lib/types";
import { MAX_SUGGESTIONS_SHOWN } from "@/lib/ui-constants";

interface FriendSuggestionsProps {
  sourceMember: PartyMember;
  mutuals: NetworkMember[];
  following: NetworkMember[];
  loading: boolean;
  error?: string;
  truncated?: boolean;
  partyUsernames: Set<string>;
  onAdd: (username: string) => string | null;
  partyFull: boolean;
}

function SuggestionChip({
  person,
  onAdd,
  disabled,
}: {
  person: NetworkMember;
  onAdd: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      className="flex items-center gap-2 rounded-full border border-lb-ocean bg-lb-charcoal py-1 pl-1 pr-3 text-left transition hover:border-lb-vivid hover:bg-lb-shadow disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="h-8 w-8 overflow-hidden rounded-full bg-lb-shadow">
        {person.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={person.avatarUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-lb-mist">
            {person.username.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
      <span className="text-sm text-lb-porcelain">@{person.username}</span>
      <span className="text-xs font-medium text-lb-vivid">+</span>
    </button>
  );
}

export function FriendSuggestions({
  sourceMember,
  mutuals,
  following,
  loading,
  error,
  truncated,
  partyUsernames,
  onAdd,
  partyFull,
}: FriendSuggestionsProps) {
  const availableMutuals = mutuals
    .filter((m) => !partyUsernames.has(m.username))
    .slice(0, MAX_SUGGESTIONS_SHOWN);

  const availableFollowing = following
    .filter((m) => !partyUsernames.has(m.username))
    .slice(0, Math.max(0, MAX_SUGGESTIONS_SHOWN - availableMutuals.length));

  if (!loading && !error && availableMutuals.length === 0 && availableFollowing.length === 0) {
    return null;
  }

  const label =
    sourceMember.displayName ?? `@${sourceMember.username}`;

  return (
    <div className="space-y-3 rounded-xl border border-lb-shadow bg-lb-charcoal/60 p-4">
      <div>
        <h3 className="text-sm font-medium text-lb-mist">
          Add friends of {label}
        </h3>
        <p className="mt-0.5 text-xs text-lb-steel">
          Mutual followers on Letterboxd — click to add to the watch party.
          {truncated && " (Large lists were partially scanned.)"}
        </p>
      </div>

      {loading && (
        <p className="text-sm text-lb-cloud">Loading their network…</p>
      )}

      {error && (
        <p className="text-sm text-lb-star" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && availableMutuals.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-lb-steel">
            Mutuals ({availableMutuals.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {availableMutuals.map((person) => (
              <SuggestionChip
                key={person.username}
                person={person}
                disabled={partyFull}
                onAdd={() => onAdd(person.username)}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && !error && availableFollowing.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-lb-steel">
            Also follows
          </p>
          <div className="flex flex-wrap gap-2">
            {availableFollowing.map((person) => (
              <SuggestionChip
                key={person.username}
                person={person}
                disabled={partyFull}
                onAdd={() => onAdd(person.username)}
              />
            ))}
          </div>
        </div>
      )}

      {!loading &&
        !error &&
        availableMutuals.length === 0 &&
        availableFollowing.length === 0 &&
        (mutuals.length > 0 || following.length > 0) && (
          <p className="text-sm text-lb-cloud">
            Everyone suggested is already in the party.
          </p>
        )}
    </div>
  );
}
