import type { Film, OverlapFilm, PartyMember } from "./types";

export const MIN_OVERLAP_COUNT = 2;

/** Films shared by at least 2 members, sorted by most overlap first. */
export function computeRankedOverlap(
  watchlists: Map<string, Film[]>,
  members: PartyMember[]
): OverlapFilm[] {
  if (members.length < MIN_OVERLAP_COUNT) return [];

  const bySlug = new Map<
    string,
    { film: Film; presentFor: PartyMember[] }
  >();

  for (const member of members) {
    for (const film of watchlists.get(member.username) ?? []) {
      const entry = bySlug.get(film.slug);
      if (entry) {
        if (!entry.presentFor.some((m) => m.username === member.username)) {
          entry.presentFor.push(member);
        }
      } else {
        bySlug.set(film.slug, { film, presentFor: [member] });
      }
    }
  }

  const partySize = members.length;
  const results: OverlapFilm[] = [];

  for (const { film, presentFor } of bySlug.values()) {
    if (presentFor.length < MIN_OVERLAP_COUNT) continue;
    results.push({
      ...film,
      presentFor,
      overlapCount: presentFor.length,
      partySize,
    });
  }

  results.sort((a, b) => {
    if (b.overlapCount !== a.overlapCount) {
      return b.overlapCount - a.overlapCount;
    }
    return a.title.localeCompare(b.title);
  });

  return results;
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number
): { items: T[]; page: number; totalPages: number; total: number } {
  const total = items.length;
  if (total === 0) {
    return { items: [], page: 1, totalPages: 1, total: 0 };
  }

  const totalPages = Math.ceil(total / pageSize);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
  };
}
