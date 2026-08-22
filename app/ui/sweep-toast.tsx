"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { withPins } from "@/app/ui/keep-pins";

const DISMISS_KEY = "hq:sweep-dismissed";

/**
 * Lower-right nudge when transcripts cross the 30-day mark. It's a link, not a
 * modal — clicking opens the Sweep panel on the right and the terminal keeps
 * running, so you can decide sweep-or-keep without dropping what you're doing.
 * Dismissing hides it for the rest of the browser session only; the panel is
 * always reachable at /sweep.
 */
export default function SweepToast() {
  const [count, setCount] = useState(0);
  const [href, setHref] = useState("/sweep");
  const [gone, setGone] = useState(true);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* storage off — just show it */
    }
    if (dismissed) return;
    // Preserve ?session/?wall/?lead so opening the panel never resets Terminal 1.
    setHref(withPins("/sweep", window.location.search));
    fetch("/api/sweep")
      .then((r) => r.json())
      .then((j) => {
        if (j?.count > 0) {
          setCount(j.count);
          setGone(false);
        }
      })
      .catch(() => {
        /* the nudge is optional — never let it surface an error */
      });
  }, []);

  if (gone || !count) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950/95 px-3 py-2 font-mono text-xs shadow-xl backdrop-blur">
      <span className="text-amber-400">◦</span>
      <span className="text-zinc-300">
        {count} transcript{count === 1 ? "" : "s"} past 30 days
      </span>
      <Link
        href={href}
        onClick={() => setGone(true)}
        className="text-[10px] uppercase tracking-wide text-blue-400 hover:text-blue-300"
      >
        sweep or keep
      </Link>
      <button
        aria-label="Dismiss"
        onClick={() => {
          setGone(true);
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* ignore */
          }
        }}
        className="text-zinc-600 hover:text-zinc-300"
      >
        ✕
      </button>
    </div>
  );
}
