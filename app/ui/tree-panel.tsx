"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import AgentTree, { type SessionBranch } from "@/app/ui/agent-tree";
import { useTree } from "@/app/ui/tree-state";
import type { BackgroundAgent } from "@/lib/jobs";
import type { Team } from "@/lib/teams";

// The Tree panel — the single-pane agent hierarchy as a standalone toggle panel
// (its own portal root #tree-panel-root), mirroring the Changelog / Skills
// panels: AppPanel chrome, a live /api/tree fetch on open. Reuses the route's
// AgentTree client view verbatim — each interactive session that spawned
// subagents (with its nested children), the headless background/dispatched
// agents, and any experimental agent teams. All read-only, on-disk. Clicking a
// row pins that branch's parent session in the terminal (AgentTree carries the
// pins); subagents aren't separately resumable.

type TreeData = {
  sessions: SessionBranch[];
  jobs: BackgroundAgent[];
  teams: Team[];
};

export default function TreePanel() {
  const { open, setOpen } = useTree();
  const [data, setData] = useState<TreeData>({ sessions: [], jobs: [], teams: [] });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/tree", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "failed to load");
      setData({ sessions: d.sessions ?? [], jobs: d.jobs ?? [], teams: d.teams ?? [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const totalSub = data.sessions.reduce((n, s) => n + s.subagents.length, 0);

  return (
    <AppPanel
      rootId="tree-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="tree-panel.tsx">
        {/* header — summary count + refresh (shrink-0, stays put above the tree) */}
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="font-mono text-xs text-zinc-300">tree</span>
          <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
            {totalSub} subagent{totalSub === 1 ? "" : "s"}
            {data.jobs.length > 0 ? ` · ${data.jobs.length} background` : ""}
          </span>
          <button
            onClick={() => load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="ml-auto flex shrink-0 items-center self-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
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

        {/* AgentTree reads ?session via useSearchParams → wrap in Suspense so a
            prerender of the shell never trips the missing-boundary guard. It owns
            its own min-h-0 flex-1 overflow scroll, staying inside the dashed frame. */}
        <Suspense fallback={null}>
          <AgentTree sessions={data.sessions} jobs={data.jobs} teams={data.teams} />
        </Suspense>

        <p className="shrink-0 text-xs text-zinc-600">
          nested subagents + background/dispatched agents Claude Code wrote to disk · click a row to pin its parent session · subagents aren&apos;t separately resumable
        </p>
      </Boundary>
    </AppPanel>
  );
}
