/** Letterboxd CDN poster URL built from LazyPoster watchlist metadata. */

export function posterSlugVariants(itemSlug: string, year?: number): string[] {
  const variants = new Set<string>([itemSlug]);

  if (year) {
    const yearSuffix = `-${year}`;
    if (itemSlug.endsWith(yearSuffix)) {
      variants.add(itemSlug.slice(0, -yearSuffix.length));
    }
  }

  return [...variants];
}

/** Build candidate poster URLs (most likely first). */
export function buildPosterUrlCandidates(
  itemSlug: string,
  filmUid: string,
  cacheBustingKey: string,
  width = 125,
  height = 187,
  year?: number
): string[] {
  const match = filmUid.match(/^film:(\d+)$/);
  if (!match) return [];

  const filmId = match[1]!;
  const digitPath = filmId.split("").join("/");
  const slugs = posterSlugVariants(itemSlug, year);
  const candidates: string[] = [];

  for (const posterSlug of slugs) {
    const base = `https://a.ltrbxd.com/resized/film-poster/${digitPath}/${filmId}-${posterSlug}`;
    candidates.push(
      `${base}-0-${width}-0-${height}-crop.jpg?v=${cacheBustingKey}`
    );
    candidates.push(
      `${base}--0-${width}-0-${height}-crop.jpg?v=${cacheBustingKey}`
    );
  }

  return [...new Set(candidates)];
}

export function buildPosterUrl(
  itemSlug: string,
  filmUid: string,
  cacheBustingKey: string,
  width = 125,
  height = 187,
  year?: number
): string | undefined {
  return buildPosterUrlCandidates(
    itemSlug,
    filmUid,
    cacheBustingKey,
    width,
    height,
    year
  )[0];
}

export function decodeHtmlJsonAttr(raw: string): unknown {
  const decoded = raw
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return JSON.parse(decoded);
}

export interface ResolvablePosterPath {
  lid: string;
  uid: string;
  cacheBustingKey: string;
  hasDefaultPoster: boolean;
}

export function parseResolvablePosterPath(
  raw: string | undefined
): ResolvablePosterPath | null {
  if (!raw) return null;

  try {
    const data = decodeHtmlJsonAttr(raw) as {
      postered?: { lid?: string; uid?: string };
      cacheBustingKey?: string;
      hasDefaultPoster?: boolean;
    };

    const lid = data.postered?.lid;
    const uid = data.postered?.uid;
    const cacheBustingKey = data.cacheBustingKey;

    if (!lid || !uid || !cacheBustingKey) return null;

    return {
      lid,
      uid,
      cacheBustingKey,
      hasDefaultPoster: data.hasDefaultPoster !== false,
    };
  } catch {
    return null;
  }
}
