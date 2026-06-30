"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useSavings } from "@/app/ui/savings-state";

// hq's Savings panel — a standalone client-state portal (its own
// #savings-panel-root), migrated out of @panel/(metrics)/savings and mirroring
// the Skills / Changelog panels. ONE number is live: how many tokens were read
// from the prompt cache in the last 7 days (fetched from /api/savings on open).
// Everything else — the five levers, the roadmap, the $ assumptions — is static
// copy that the source route kept in the client too, so it lives here.

// Opus-tier prices per million tokens — the assumption behind the headline
// number. Cache reads bill at ~10% of fresh input, so every cache-read token is
// ~90% saved.
const INPUT_PER_M = 15;
const CACHE_READ_PER_M = 1.5;

// /api/savings JSON shape (inlined — never import a node:fs lib into a client
// bundle; Turbopack would drag fs along).
type SavingsData = { cacheRead: number; generatedAt?: number };

function fmtTok(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

const IDEAS: { title: string; where: string; how: string }[] = [
  {
    title: "Cache clock",
    where: "terminal header + session cards",
    how: "the prompt cache holds ~5 minutes; reply inside the window and the whole history reads at ~10% price. The countdown teaches batching asks while it's warm instead of dribbling messages over twenty minutes.",
  },
  {
    title: "Context gauge + wrap-up nudge",
    where: "terminal header",
    how: "auto-compact is the worst-case token event — a huge summarization turn at the worst moment, plus quality loss. The gauge shows distance to it; at 70% a nudge offers a wrap-up prompt (handoff note → memory → /clear) instead.",
  },
  {
    title: "Memory + CLAUDE.md weight audit",
    where: "Memory Audit panel",
    how: "the MEMORY.md index and CLAUDE.md files load at the start of EVERY session — a standing tax. Every 1k tokens pruned is saved hundreds of times. The only compounding savings there is.",
  },
  {
    title: "Turn-cost attribution",
    where: "tool steps in the terminal stream",
    how: "each tool step shows its rough context cost; fat ones go amber/red. Seeing \"this Read cost 18k tokens\" turns expensive habits into CLAUDE.md rules.",
  },
  {
    title: "Draft buffer",
    where: "the send box (+ queue)",
    how: "asks queued while Claude works go out as ONE message — one context read instead of three. Pure behavior win, pairs with the cache clock.",
  },
];

export default function SavingsPanel() {
  const { open, setOpen } = useSavings();
  const [data, setData] = useState<SavingsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/savings", { cache: "no-store" }).then((res) => res.json());
      if (r?.error) throw new Error(r.error);
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const cacheRead = data?.cacheRead ?? 0;
  const savedDollars = (cacheRead / 1e6) * (INPUT_PER_M - CACHE_READ_PER_M);

  return (
    <AppPanel
      rootId="savings-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="savings-panel.tsx">
        {/* header — title + refresh */}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">savings</span>
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
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">{err}</p>
        )}

        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2">
          {/* headline — the one live number */}
          <section className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              this week, prompt caching alone
            </span>
            <span className="text-2xl font-semibold text-emerald-400">
              {loading && !data ? "…" : `≈ $${Math.round(savedDollars).toLocaleString("en-US")} saved`}
            </span>
            <span className="text-xs text-zinc-500">
              {fmtTok(cacheRead)} tokens read from cache instead of fresh — billed at ~10% of input
              price (assumes Opus-tier rates, ${INPUT_PER_M}/M in). Staying inside cache windows is
              what keeps this number big.
            </span>
          </section>

          {/* the five levers */}
          <section className="flex flex-col gap-2">
            <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              the five levers — all live as v1s
            </h2>
            <ul className="flex flex-col gap-2">
              {IDEAS.map((idea) => (
                <li
                  key={idea.title}
                  className="flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2"
                >
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-zinc-200">{idea.title}</span>
                    <span className="font-mono text-[10px] text-zinc-600">{idea.where}</span>
                  </span>
                  <p className="text-xs leading-relaxed text-zinc-400">{idea.how}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* roadmap */}
          <section className="flex flex-col gap-1">
            <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              explode this out — next session
            </h2>
            <ul className="list-inside list-disc text-xs leading-relaxed text-zinc-400">
              <li>
                quantify each lever: cache hits inside vs outside the 5-minute window, wrap-ups taken
                vs auto-compacts eaten, fat tool steps per session over time
              </li>
              <li>
                a could-save column: cold-cache re-reads that batching would have avoided, priced in $
              </li>
              <li>
                weekly trend — is behavior actually changing, or is this just a pretty number
              </li>
              <li>
                tie into <span className="text-zinc-300">Memory Audit</span>: standing-tax tokens ×
                sessions started = the prune payoff, in $
              </li>
            </ul>
          </section>
        </div>

        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          One live number — cache reads from the last 7 days, via /api/savings. The rest is the
          savings roadmap.
        </footer>
      </Boundary>
    </AppPanel>
  );
}
