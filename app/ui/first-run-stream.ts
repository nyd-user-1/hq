"use client";

import { useEffect, useRef, useState } from "react";

// THE CENSUS FLOOD — a once-ever first-run reveal. The first time a surface
// with real rows mounts on this machine, its history streams in oldest-first:
// each newer row lands at the TOP and pushes the stack down, accelerating from
// row-by-row into a flood — so the final row to arrive is the newest, already
// sitting exactly where the settled view starts. No scrolling, no settle
// animation; the stream ends and you are simply there. Plays once per surface
// (localStorage flag), capped at ~3.5s, instant on every later visit;
// `?firstrun=1` replays it for demos.
//
// Returns how many TRAILING rows to render; callers do
//   n === 0 ? [] : rows.slice(-n)     (rows sorted newest-first)
export function useFirstRunStream(key: string, total: number): number {
  const [count, setCount] = useState(0);
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current || total === 0) return;
    decided.current = true;

    let force = false;
    try {
      force = new URLSearchParams(window.location.search).get("firstrun") === "1";
    } catch {}
    let seen = false;
    try {
      seen = localStorage.getItem(`hq-firstrun-${key}`) === "1";
    } catch {}
    if (seen && !force) {
      setCount(Number.MAX_SAFE_INTEGER);
      return;
    }
    try {
      localStorage.setItem(`hq-firstrun-${key}`, "1");
    } catch {}

    // Row-by-row at first, then the flood: quadratic ease-in over a duration
    // that scales with the census but never drags (1.4s floor, 3.5s cap).
    const DURATION = Math.min(3500, Math.max(1400, total * 90));
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      setCount(Math.max(1, Math.round(t * t * total)));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setCount(Number.MAX_SAFE_INTEGER);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, total]);

  return Math.min(count, total);
}
