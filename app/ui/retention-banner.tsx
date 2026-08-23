"use client";

import { useEffect, useState } from "react";
import { onSessionsPopulated } from "@/app/ui/first-run-stream";

// THE RETENTION BANNER — first-run consent card for transcript keeping.
// Claude Code's default `cleanupPeriodDays` (30) silently deletes transcripts a
// month old; most users don't know, and everything HQ builds on history —
// search, the census, sweep-or-keep — quietly starves. This banner shows when
// the pin is absent, says so plainly, and one click pins retention to 3650 via
// /api/retention. "Delete Files" declines for good (localStorage); the × only
// hides it for THIS load — it resurfaces every visit until one of the two
// buttons is actually pressed. Never a silent write; the click IS the consent.
// Rides the send box on the sessions view as a one-line strip (terminal.tsx
// mounts it in the dock). `?retention=1` (or the catch-all `?demo=1`) forces it
// for demos.
export default function RetentionBanner() {
  const [state, setState] = useState<"hidden" | "ask" | "saving" | "done">("hidden");
  const [populated, setPopulated] = useState(false); // the sessions table has finished populating
  const [entered, setEntered] = useState(false); // slid into place (drives the CSS transition)

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

  // Wait for the table (first-run flood included), then slide in on the frame
  // AFTER mount so the transition actually runs.
  useEffect(() => onSessionsPopulated(() => setPopulated(true)), []);
  const visible = state !== "hidden" && populated;
  useEffect(() => {
    if (!visible) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setEntered(true)); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [visible]);

  if (!visible) return null;

  // slide back down behind the input, then unmount
  const hide = () => {
    setEntered(false);
    setTimeout(() => setState("hidden"), 520);
  };
  const dismiss = () => {
    try {
      localStorage.setItem("hq-retention-dismissed", "1");
    } catch {}
    hide();
  };
  // × — not a decision: hides the strip for this load only (no flag written), so
  // it comes back next visit until Keep / Delete is pressed.
  const later = () => hide();
  const keep = async () => {
    setState("saving");
    try {
      const r = await fetch("/api/retention", { method: "POST" });
      if (!r.ok) throw new Error();
      setState("done");
      try {
        localStorage.setItem("hq-retention-dismissed", "1");
      } catch {}
      setTimeout(hide, 3200);
    } catch {
      setState("ask");
    }
  };

  // A send-box STRIP — the launch / search banners' exact shape (rounded-t, the
  // input card overlaps its lower edge), one line, never wraps. It arrives by
  // sliding UP from behind the input: the outer slot opens (max-height) while the
  // strip translates in; the slot clips, so nothing shows until it moves. Controls
  // pin right; pb-7 lifts them clear of the send-box chip that overlaps that corner.
  return (
    <div className={`overflow-hidden transition-[max-height] duration-500 ease-out ${entered ? "max-h-12" : "max-h-0"}`}>
      <div
        className={`-mb-3 flex items-center gap-2 whitespace-nowrap rounded-t-lg border border-b-0 border-zinc-800 bg-zinc-900/60 px-3 pb-7 pt-1.5 font-mono text-[11px] text-zinc-400 transition-transform duration-500 ease-out ${
          entered ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-amber-400" />
        {state === "done" ? (
          <span className="text-emerald-400/90">
            Done — transcripts are kept until <span className="text-zinc-300">you</span> sweep them.
          </span>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-zinc-300">Claude Code deletes transcripts after 30 days</span>
              {" — keep them?"}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <button
                onClick={keep}
                disabled={state === "saving"}
                className="rounded bg-blue-600 px-2 py-0.5 text-[11px] text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
              >
                {state === "saving" ? "Saving…" : "Keep files"}
              </button>
              <button
                onClick={dismiss}
                className="rounded px-1.5 py-0.5 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                Delete files
              </button>
              {/* × — "not now" (this load only), pinned at the right end */}
              <button
                onClick={later}
                title="not now — asks again next time"
                aria-label="dismiss for now"
                className="ml-1 rounded p-0.5 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
