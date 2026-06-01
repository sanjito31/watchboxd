"use client";

import { useState } from "react";

interface PosterImageProps {
  slug: string;
  posterUrl?: string;
  posterUrls?: string[];
  className?: string;
  width?: number;
  height?: number;
}

export function PosterImage({
  slug,
  posterUrl,
  posterUrls,
  className,
  width = 48,
  height = 72,
}: PosterImageProps) {
  const candidates = [
    ...new Set([...(posterUrls ?? []), ...(posterUrl ? [posterUrl] : [])]),
  ];
  const [index, setIndex] = useState(0);
  const [apiUrl, setApiUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const src = apiUrl ?? candidates[index];

  if (!src || failed) {
    return (
      <span
        className={`flex items-center justify-center rounded bg-lb-shadow text-xs text-lb-ghost ${className ?? ""}`}
        style={{ width, height }}
      >
        ?
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={width}
      height={height}
      referrerPolicy="origin"
      className={className}
      onError={() => {
        if (!apiUrl && index + 1 < candidates.length) {
          setIndex((i) => i + 1);
          return;
        }
        if (!apiUrl) {
          void fetch(`/api/poster/${encodeURIComponent(slug)}`)
            .then((res) => res.json())
            .then((data: { posterUrl?: string }) => {
              if (data.posterUrl) {
                setApiUrl(data.posterUrl);
              } else {
                setFailed(true);
              }
            })
            .catch(() => setFailed(true));
          return;
        }
        setFailed(true);
      }}
    />
  );
}
