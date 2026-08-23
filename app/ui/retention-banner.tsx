"use client";

import { useEffect, useState } from "react";

// THE RETENTION BANNER — first-run consent card for transcript keeping.
// Claude Code's default `cleanupPeriodDays` (30) silently deletes transcripts a
// month old; most users don't know, and everything HQ builds on history —
// search, the census, sweep-or-keep — quietly starves. This banner shows when
// the pin is absent, says so plainly, and one click pins retention to 3650 via
// /api/retention. "Delete Files" declines for good (localStorage); the × only
// hides it for THIS load — it resurfaces every visit until one of the two
// buttons is actually pressed. Never a silent write; the click IS the consent.
// Sits UNDER the sessions table. `?retention=1` (or the catch-all `?demo=1`)
// forces it for demos.
export default function RetentionBanner() {
  const [state, setState] = useState<"hidden" | "ask" | "saving" | "done">("hidden");

  useEffect(() => {
    let force = false;
    try {
      const sp = new URLSearchParams(window.location.search);
      force = sp.get("retention") === "1" || sp.get("demo") === "1";
    } catch {}
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("hq-retention-dismissed") === "1";
    } catch {}
    if (dismissed && !force) return;
    fetch("/api/retention")
      .then((r) => r.json())
      .then((d) => {
        if (force || (!d.pinned && !d.parseError)) setState("ask");
      })
      .catch(() => {});
  }, []);

  if (state === "hidden") return null;

  const dismiss = () => {
    try {
      localStorage.setItem("hq-retention-dismissed", "1");
    } catch {}
    setState("hidden");
  };
  // × — not a decision: hides the card for this load only (no flag written), so
  // it comes back next visit until Keep / Delete is pressed.
  const later = () => setState("hidden");
  const keep = async () => {
    setState("saving");
    try {
      const r = await fetch("/api/retention", { method: "POST" });
      if (!r.ok) throw new Error();
      setState("done");
      try {
        localStorage.setItem("hq-retention-dismissed", "1");
      } catch {}
      setTimeout(() => setState("hidden"), 3200);
    } catch {
      setState("ask");
    }
  };

  return (
    <div className="relative flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-900/30 py-2.5 pl-3.5 pr-9">
      {/* × — top-right, "not now" (this load only) */}
      <button
        onClick={later}
        title="not now — asks again next time"
        aria-label="dismiss for now"
        className="absolute right-1.5 top-1.5 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
      <span className="size-2 shrink-0 rounded-full bg-amber-400" />
      {state === "done" ? (
        <span className="font-mono text-[12px] text-emerald-400/90">
          Done — your transcripts are kept until <span className="text-zinc-300">you</span> sweep them.
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1 font-mono text-[12px] leading-relaxed">
            <span className="block text-zinc-300">Claude Code deletes transcripts after 30 days.</span>
            <span className="block text-zinc-500">Would you rather keep them?</span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={keep}
              disabled={state === "saving"}
              className="rounded-md bg-blue-600 px-3 py-1 font-mono text-[12px] text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
            >
              {state === "saving" ? "Saving…" : "Keep files"}
            </button>
            <button
              onClick={dismiss}
              className="rounded-md px-2 py-1 font-mono text-[12px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            >
              Delete Files
            </button>
          </span>
        </>
      )}
    </div>
  );
}
