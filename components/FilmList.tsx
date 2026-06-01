import type { OverlapFilm } from "@/lib/types";
import { AvatarStack } from "./AvatarStack";
import { PosterImage } from "./PosterImage";

interface FilmListProps {
  films: OverlapFilm[];
}

export function FilmList({ films }: FilmListProps) {
  if (films.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-lb-ocean px-6 py-12 text-center text-lb-cloud">
        No films appear on at least two watchlists yet. Try adding more
        members or run Find overlap again.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-lb-shadow rounded-xl border border-lb-shadow overflow-hidden">
      {films.map((film) => (
        <li key={film.slug}>
          <a
            href={film.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex cursor-pointer items-center gap-4 bg-lb-charcoal px-4 py-3 transition hover:bg-lb-shadow"
          >
            <span className="shrink-0">
              <PosterImage
                slug={film.slug}
                posterUrl={film.posterUrl}
                posterUrls={film.posterUrls}
                width={48}
                height={72}
                className="h-[72px] w-12 rounded object-cover bg-lb-shadow"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-lb-porcelain transition group-hover:text-lb-vivid">
                {film.title}
                {film.year != null && (
                  <span className="font-normal text-lb-steel">
                    {" "}
                    ({film.year})
                  </span>
                )}
              </span>
              <span className="text-xs text-lb-steel">
                On {film.overlapCount} of {film.partySize} watchlists
              </span>
            </span>
            <AvatarStack members={film.presentFor} />
          </a>
        </li>
      ))}
    </ul>
  );
}
