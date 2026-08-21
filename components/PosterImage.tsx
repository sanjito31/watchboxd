"use client";

import { useState } from "react";
import { DEFAULT_POSTER_PLACEHOLDER_URL } from "@/lib/movies/posters";

interface PosterImageProps {
  posterUrl: string | null;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
}

export function buildPosterCandidates(
  posterUrl: string | null
): string[] {
  return [
    ...new Set(
      [
        posterUrl,
        DEFAULT_POSTER_PLACEHOLDER_URL,
      ].filter((url): url is string => Boolean(url?.trim()))
    ),
  ];
}

export function PosterImage({
  posterUrl,
  alt,
  className,
  width = 48,
  height = 72,
}: PosterImageProps) {
  const candidates = buildPosterCandidates(posterUrl);
  const candidateKey = candidates.join("\u0000");
  const [selection, setSelection] = useState({ candidateKey, index: 0 });
  const index =
    selection.candidateKey === candidateKey ? selection.index : 0;
  const src = candidates[index];

  if (!src) {
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
      alt={alt}
      width={width}
      height={height}
      referrerPolicy="origin"
      className={className}
      onError={() => {
        setSelection({
          candidateKey,
          index: index + 1,
        });
      }}
    />
  );
}
