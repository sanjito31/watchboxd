import { USERNAME_PATTERN } from "./constants";

export function parseUsername(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed;

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const host = url.hostname.replace(/^www\./, "");
      if (host !== "letterboxd.com") return null;
      const segment = url.pathname.split("/").filter(Boolean)[0];
      if (!segment) return null;
      candidate = segment;
    }
  } catch {
    return null;
  }

  candidate = candidate.replace(/^@/, "");

  if (!USERNAME_PATTERN.test(candidate)) return null;
  return candidate.toLowerCase();
}
