"use client";

import { useSyncExternalStore } from "react";
import { WatchPartyApp } from "./WatchPartyApp";

function subscribe() {
  return () => {};
}

export function HomeClient() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  if (!mounted) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-lb-cloud">
        Loading…
      </div>
    );
  }

  return <WatchPartyApp />;
}
