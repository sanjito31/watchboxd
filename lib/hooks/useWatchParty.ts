"use client";

import { useCallback, useEffect, useState } from "react";
import type { PartyMember } from "@/lib/types";
import { parseUsername } from "@/lib/letterboxd/parseUsername";

const STORAGE_KEY = "letterboxd-watch-party";
const MAX_PARTY_SIZE = 10;

function membersFromQuery(): PartyMember[] {
  const raw = new URLSearchParams(window.location.search).get("users");
  if (!raw) return [];

  return raw
    .split(",")
    .map((s) => parseUsername(s.trim()))
    .filter((u): u is string => u !== null)
    .map((username) => ({ username }));
}

function readStorage(): PartyMember[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PartyMember[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStorage(members: PartyMember[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
}

function syncUrl(members: PartyMember[]): void {
  const params = new URLSearchParams(window.location.search);
  if (members.length === 0) {
    params.delete("users");
  } else {
    params.set("users", members.map((m) => m.username).join(","));
  }
  const query = params.toString();
  const next = query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;
  window.history.replaceState(null, "", next);
}

function loadInitialMembers(): PartyMember[] {
  const params = new URLSearchParams(window.location.search);

  if (params.has("fresh")) {
    localStorage.removeItem(STORAGE_KEY);
    params.delete("fresh");
    const query = params.toString();
    const next = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;
    window.history.replaceState(null, "", next);
    return [];
  }

  const fromQuery = membersFromQuery();
  return fromQuery.length > 0 ? fromQuery : readStorage();
}

export function useWatchParty() {
  const [members, setMembers] = useState<PartyMember[]>(loadInitialMembers);

  useEffect(() => {
    writeStorage(members);
    syncUrl(members);
  }, [members]);

  const addMember = useCallback(
    (input: string): string | null => {
      const username = parseUsername(input);
      if (!username) return "Enter a valid Letterboxd username or profile URL.";
      if (members.some((m) => m.username === username)) {
        return `@${username} is already in the watch party.`;
      }
      if (members.length >= MAX_PARTY_SIZE) {
        return `Watch party is limited to ${MAX_PARTY_SIZE} members.`;
      }
      setMembers((prev) => [...prev, { username }]);
      return null;
    },
    [members]
  );

  const removeMember = useCallback((username: string) => {
    setMembers((prev) => prev.filter((m) => m.username !== username));
  }, []);

  const updateMember = useCallback(
    (username: string, patch: Partial<PartyMember>) => {
      setMembers((prev) =>
        prev.map((m) => (m.username === username ? { ...m, ...patch } : m))
      );
    },
    []
  );

  const copyShareLink = useCallback(async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearParty = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setMembers([]);
    syncUrl([]);
  }, []);

  return {
    members,
    hydrated: true,
    addMember,
    removeMember,
    updateMember,
    copyShareLink,
    clearParty,
    maxPartySize: MAX_PARTY_SIZE,
  };
}
