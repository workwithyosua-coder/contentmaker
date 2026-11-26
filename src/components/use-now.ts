"use client";

import { useSyncExternalStore } from "react";

// A ticking clock for relative times ("Updated 6s ago"). On the server, and during hydration, it is null, so the
// server HTML never carries a time that the browser would render differently. One shared timer per interval.
type Clock = { subscribe: (cb: () => void) => () => void; get: () => number; server: () => null };
const clocks = new Map<number, Clock>();

function clock(ms: number): Clock {
  const hit = clocks.get(ms);
  if (hit) return hit;
  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  const subs = new Set<() => void>();
  const c: Clock = {
    subscribe(cb) {
      subs.add(cb);
      if (!timer) {
        now = Date.now();
        timer = setInterval(() => {
          now = Date.now();
          subs.forEach((f) => f());
        }, ms);
      }
      return () => {
        subs.delete(cb);
        if (!subs.size && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    get: () => now,
    server: () => null,
  };
  clocks.set(ms, c);
  return c;
}

export function useNow(ms = 1000): number | null {
  const c = clock(ms);
  return useSyncExternalStore(c.subscribe, c.get, c.server);
}
