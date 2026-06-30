"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import CopyText from "@/app/ui/copy-text";
import { useCalls } from "@/app/ui/calls-state";
import { fmtUSD } from "@/lib/pricing";
import type { Call, CallKind } from "@/lib/calls";

// Compact k/M token formatter (matches the route page).
function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

// The notable (non-default) call origins, colored so they pop against the model
// name. A normal interactive call shows ONLY its model — labeling 99.6% of rows
// "interactive" would be noise.
const ORIGIN: Record<Exclude<CallKind, "interactive">, { word: string; cls: string }> = {
  headless: { word: "headless", cls: "text-cyan-400" },
  subagent: { word: "subagent", cls: "text-amber-400" },
  "hook/usage": { word: "hook", cls: "text-blue-300" },
};
const KIND_WORD: Record<CallKind, string> = {
  interactive: "interactive",
  headless: "headless",
  subagent: "subagent",
  "hook/usage": "hook · usage",
};

type Spend = { session: number; today: number; week: number };
type Feed = { calls: Call[]; total: number; totalCost: number; cap: number; spend: Spend };

// The Calls panel — hq's dollar-priced ledger of every API round-trip across all
// transcripts, in a standalone toggle panel (its own portal root #calls-panel-root),
// mirroring the Changelog panel: AppPanel chrome, a live /api/calls fetch. A row
// opens its full token/$ breakdown IN the panel (drill-down + back). The clicked
// row's Call object is already in the loaded feed, so the drill-down needs no
// second fetch.
export default function CallsPanel() {
  const { open, setOpen } = useCalls();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Call | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/calls", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "failed to load");
      setFeed(d as Feed);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const spend = feed?.spend;
  const calls = feed?.calls ?? [];

  return (
    <AppPanel
      rootId="calls-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="calls-panel.tsx">
        {sel ? (
          // ── call drill-down ──────────────────────────────────────────────
          <>
            <div className="flex shrink-0 items-center gap-3">
              <button
                onClick={() => setSel(null)}
                className="shrink-0 cursor-pointer font-mono text-xs text-blue-400 hover:text-blue-300"
              >
                ← calls
              </button>
              <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
                {sel.project} · {sel.session.slice(0, 8)} ·{" "}
                <span suppressHydrationWarning>{new Date(sel.at).toLocaleTimeString()}</span>
              </span>
            </div>
            <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-auto border-t border-zinc-800 pt-4 font-mono">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-3xl font-bold ${sel.premium ? "text-amber-400" : "text-emerald-300"}`}
                >
                  {fmtUSD(sel.cost)}
                </span>
                {sel.premium && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                    2× · past the 200k cliff
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-[11px]">
                <Field k="model" v={sel.model} />
                <Field k="type" v={KIND_WORD[sel.kind]} />
                <Field
                  k="session"
                  v={
                    <CopyText text={sel.session} className="text-zinc-300 hover:text-zinc-100">
                      {sel.session}
                    </CopyText>
                  }
                />
                <Field
                  k="time"
                  v={<span suppressHydrationWarning>{new Date(sel.at).toLocaleString()}</span>}
                />
                <div className="col-span-2 my-1 border-t border-dashed border-zinc-800" />
                <Field k="input" v={sel.input.toLocaleString()} />
                <Field k="cache write" v={sel.cacheCreate.toLocaleString()} />
                <Field k="cache read" v={sel.cacheRead.toLocaleString()} />
                <Field k="output" v={sel.output.toLocaleString()} />
                <Field k="raw total" v={sel.raw.toLocaleString()} />
                <Field
                  k="weighted"
                  v={
                    <span className="text-zinc-400">
                      {Math.round(sel.weightedTokens).toLocaleString()}
                    </span>
                  }
                />
              </dl>
            </div>
          </>
        ) : (
          // ── ledger feed ──────────────────────────────────────────────────
          <>
            <div className="flex shrink-0 items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">calls</span>
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

            {/* spend header — session / today / week, FIXED above the scroll */}
            <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs">
              <span className="uppercase tracking-wide text-zinc-600">spend</span>
              <span className="text-emerald-300">
                {spend ? fmtUSD(spend.session) : "—"} <span className="text-zinc-600">session</span>
              </span>
              <span className="text-zinc-300">
                {spend ? fmtUSD(spend.today) : "—"} <span className="text-zinc-600">today</span>
              </span>
              <span className="text-zinc-300">
                {spend ? fmtUSD(spend.week) : "—"} <span className="text-zinc-600">week</span>
              </span>
            </div>

            {err && (
              <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
                {err}
              </p>
            )}

            {/* the list OWNS the scroll (min-h-0 flex-1 overflow-y-auto) so it stays
                WITHIN the panel's dashed frame; the header + spend above are shrink-0. */}
            <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
              {calls.map((c, i) => {
                const proj = c.project.length > 8 ? `${c.project.slice(0, 8)}…` : c.project;
                const origin = c.kind === "interactive" ? null : ORIGIN[c.kind];
                return (
                  <li key={c.id || i}>
                    <button
                      onClick={() => setSel(c)}
                      className="flex w-full items-baseline gap-x-2.5 rounded px-1 text-left font-mono text-xs hover:bg-zinc-900/40"
                    >
                      <span className="w-16 shrink-0 text-zinc-600" suppressHydrationWarning>
                        {new Date(c.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="w-14 shrink-0 truncate text-zinc-300">{proj}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-zinc-400">{c.model}</span>
                        {origin && <span className={origin.cls}> · {origin.word}</span>}
                      </span>
                      <span className="w-10 shrink-0 text-right text-zinc-600">{fmt(c.output)}</span>
                      <span className="w-14 shrink-0 text-right text-zinc-600">{fmt(c.raw)}</span>
                      <span
                        className={`w-14 shrink-0 text-right font-medium ${
                          c.premium ? "text-amber-400" : "text-emerald-300"
                        }`}
                      >
                        {fmtUSD(c.cost)}
                        {c.premium && <span className="ml-0.5 text-[10px] text-amber-500/70">2×</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
              {!calls.length && (
                <p className="font-mono text-[11px] text-zinc-600">
                  {loading ? "loading…" : "no calls on disk yet"}
                </p>
              )}
            </ul>

            {feed && (
              <p className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
                {feed.total.toLocaleString()} calls · all-time (est.) · ~{fmtUSD(feed.totalCost)} total
                {feed.total > feed.cap && ` · showing recent ${feed.cap.toLocaleString()}`} · 2× = past
                the 200k cliff · rates in lib/pricing.ts
              </p>
            )}
          </>
        )}
      </Boundary>
    </AppPanel>
  );
}

// One detail row in the drill-down.
function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-zinc-600">{k}</dt>
      <dd className="text-zinc-300">{v}</dd>
    </>
  );
}
