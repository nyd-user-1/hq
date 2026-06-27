"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useHooks } from "@/app/ui/hooks-state";
import type { HookEntry } from "@/lib/hooks";

// hq's Hooks panel — sibling of the Skills / Commands panels. A read-only view of
// every shell command Claude Code runs around lifecycle events, grouped by event,
// read from the settings.json hook blocks (user + this repo's project settings).
// Hooks load at session INIT and the harness runs them, so this surfaces them; it
// doesn't edit them live. Click a command to copy it.

// The lifecycle events, in the order the CLI fires them — so groups read top-down.
const EVENT_ORDER = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "PreCompact",
  "Stop",
  "SubagentStop",
  "SessionEnd",
];

export default function HooksPanel() {
  const { open, setOpen } = useHooks();
  const [hooks, setHooks] = useState<HookEntry[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/hooks", { cache: "no-store" }).then((res) => res.json());
      setHooks(r?.hooks ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const query = q.trim().toLowerCase();
  const filtered = hooks.filter(
    (h) =>
      !query ||
      h.event.toLowerCase().includes(query) ||
      h.matcher.toLowerCase().includes(query) ||
      h.command.toLowerCase().includes(query),
  );

  // group by event, ordered by EVENT_ORDER (unknown events sort to the end A-Z).
  const groups = useMemo(() => {
    const by: Record<string, HookEntry[]> = {};
    for (const h of filtered) (by[h.event] ??= []).push(h);
    return Object.entries(by).sort((a, b) => {
      const ia = EVENT_ORDER.indexOf(a[0]);
      const ib = EVENT_ORDER.indexOf(b[0]);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered]);

  return (
    <AppPanel
      rootId="hooks-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="hooks-panel.tsx">
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={hooks.length ? `Search ${hooks.length} hooks…` : "Search hooks…"}
            className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          <button
            onClick={() => load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            <svg className={loading ? "animate-spin" : ""} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">{err}</p>
        )}

        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2">
          {groups.length ? (
            groups.map(([event, entries]) => (
              <div key={event} className="flex flex-col gap-2">
                <div className="flex shrink-0 items-baseline gap-2">
                  <span className="font-mono text-[11px] text-zinc-300">{event}</span>
                  <span className="font-mono text-[10px] tabular-nums text-zinc-600">{entries.length}</span>
                </div>
                {entries.map((h) => (
                  <HookCard key={h.id} h={h} />
                ))}
              </div>
            ))
          ) : (
            <p className="px-0.5 font-mono text-[11px] text-zinc-600">
              {loading ? "loading…" : query ? `no hooks match “${q}”.` : "No hooks configured."}
            </p>
          )}
        </div>

        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {hooks.length} hooks · user + project settings. Read-only — hooks load at session init.
        </footer>
      </Boundary>
    </AppPanel>
  );
}

function HookCard({ h }: { h: HookEntry }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(h.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={copy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          copy();
        }
      }}
      title="Click to copy the command"
      className="cursor-pointer rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5 text-left transition-colors hover:border-zinc-600"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
          {h.matcher ? <span className="text-zinc-300">{h.matcher}</span> : "all events"}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-zinc-600">{copied ? "copied" : h.sourceLabel}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-zinc-300">
        {h.command}
      </p>
    </div>
  );
}
