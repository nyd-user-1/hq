"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import RoutinePanel, { type RoutineGroup } from "@/app/ui/routine-panel";
import { useRoutines } from "@/app/ui/routines-state";

// hq's Routines panel — a standalone client-state portal (its own
// #routines-panel-root), cloned from the Skills / Changelog panels, as the
// console panels migrate out of @panel/(console). Operator routines by cadence
// (on-demand · local · cloud · agent), read live from the vault. Grouping
// happens server-side (/api/routines) so lib/routines' node:fs never reaches the
// browser; the existing RoutinePanel does the render + dispatch (on-demand fires
// the prompt now, the rest hand off to /schedule, both via /api/terminal).
export default function RoutinesPanel() {
  const { open, setOpen } = useRoutines();
  const [groups, setGroups] = useState<RoutineGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/routines", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "failed to load");
      setGroups(d.groups ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <AppPanel
      rootId="routines-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="routines-panel.tsx">
        {/* header — label + refresh, fixed above the scroll area */}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">
            routines
          </span>
          <button
            onClick={() => load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="flex shrink-0 items-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            <svg
              className={loading ? "animate-spin" : ""}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
            {err}
          </p>
        )}

        {/* the list OWNS the scroll so it stays WITHIN the panel's dashed frame.
            RoutinePanel renders the cadence groups, fire buttons, and its own
            empty/dispatch notes. */}
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
          {loading && !groups.length ? (
            <p className="font-mono text-[11px] text-zinc-600">loading…</p>
          ) : (
            <RoutinePanel groups={groups} />
          )}
        </div>

        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          reads !hq/*launchpad/004 Routines.md live
        </footer>
      </Boundary>
    </AppPanel>
  );
}
