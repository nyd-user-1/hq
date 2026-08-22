"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// THE CENSUS FLOOD — a once-ever first-run reveal. The first time a surface with
// real rows mounts on this machine, its rows stream in like terminal output:
// each line stacks while the scroll box follows the bottom, accelerating from
// row-by-row into a flood, then the view settles to the top and never plays
// again (localStorage flag, per surface). The value signal is honest by
// construction: every streamed line is a real row already loaded off the disk,
// it plays exactly once, it's capped at ~3.5s, and every later visit renders
// instantly. `?firstrun=1` replays it for demos.
//
// Returns how many rows to render right now; callers do rows.slice(0, n).
export function useFirstRunStream(
  key: string,
  total: number,
  followRef?: RefObject<HTMLDivElement | null>,
): number {
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
      const n = Math.max(1, Math.round(t * t * total));
      setCount(n);
      const el = followRef?.current;
      if (el) el.scrollTop = el.scrollHeight; // ride the bottom, terminal-style
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setCount(Number.MAX_SAFE_INTEGER);
        // settle: after a beat, glide back to the top of the populated view
        if (el) setTimeout(() => el.scrollTo({ top: 0, behavior: "smooth" }), 300);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, total, followRef]);

  return Math.min(count, total);
}
