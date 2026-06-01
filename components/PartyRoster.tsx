import type { PartyMember, UserWatchlist } from "@/lib/types";

interface PartyRosterProps {
  members: PartyMember[];
  watchlists: Map<string, UserWatchlist>;
  suggestionsSource: string | null;
  onSelectForSuggestions: (username: string) => void;
  onRemove: (username: string) => void;
}

export function PartyRoster({
  members,
  watchlists,
  suggestionsSource,
  onSelectForSuggestions,
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
        {members.map((member) => {
          const wl = watchlists.get(member.username);
          const status = wl?.loading
            ? "Loading…"
            : wl?.error
              ? "Failed"
              : wl?.films
                ? `${wl.films.length} films`
                : null;
          const isActive = suggestionsSource === member.username;

          return (
            <li key={member.username}>
              <div
                className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-2 transition ${
                  isActive
                    ? "border-lb-vivid bg-lb-shadow ring-1 ring-lb-vivid/40"
                    : "border-lb-ocean bg-lb-charcoal hover:border-lb-ghost hover:bg-lb-shadow"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectForSuggestions(member.username)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-pressed={isActive}
                  aria-label={`Browse friends of ${member.username}`}
                >
                  <span className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-lb-shadow">
                    {member.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.avatarUrl}
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
                        className={`text-xs ${wl?.error ? "text-lb-star" : "text-lb-steel"}`}
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
        })}
      </ul>
    </div>
  );
}
