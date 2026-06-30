"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useUsage } from "@/app/ui/usage-state";

// Types inlined (mirror lib/usage.ts) rather than imported: a bare `import type`
// from lib/usage still made Turbopack pull the node:fs module into the client
// bundle ("filesystem operations in a client component"). The API shape is the
// contract; these track it.
type MeterState = "ok" | "approaching" | "reached";
type UsageMeter = {
  key: "session" | "weekAll" | "weekOpus";
  label: string;
  span: string;
  usedWeighted: number;
  rawTokens: number;
  messages: number;
  limit: number;
  pct: number;
  rawPct: number;
  resetsAt: number | null;
  state: MeterState;
  calibrated: boolean;
  source: "live" | "modeled";
};
type Forecast = {
  burnPerMin: number;
  blockWeighted: number;
  limit: number;
  blockReset: number;
  projectedCapAt: number | null;
  underCap: boolean;
};
type UsageStates = {
  meters: UsageMeter[];
  forecast: Forecast;
  spend: unknown;
  byModel: unknown[];
  insights: unknown[];
  snapshotAt: number | null;
  generatedAt: number;
};

// The standalone Usage panel — the migration of @panel/(metrics)/metrics/page.tsx
// (the old "Usage" landing tab) into a push-in panel. Same restrained idiom as
// TokenMeter/ForecastMeter (zinc track + colored fill, mono micro-captions,
// green→red pct ramp, zinc-divider sections), wrapped in the panel chrome and
// live-polling /api/usage every 15s so the meters tick as the window burns.
//
// NB: the real /usage windows are read from API rate-limit HEADERS in-process and
// never hit disk — these are HQ's CALIBRATED model of them (lib/usage.ts), with a
// fresh statusline snapshot overlaid as the live value when one exists.

const fmt = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
};
const clock = (ms: number): string =>
  new Date(ms)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(" ", "");

// Continuous pct ramp — the same green→yellow→orange→red TokenMeter uses for its
// % text, reused here for both the % readout and the bar fill.
const pctText = (p: number) =>
  p < 50 ? "text-green-500" : p < 75 ? "text-yellow-500" : p < 90 ? "text-orange-500" : "text-red-500";
const pctBar = (p: number) =>
  p < 50 ? "bg-green-500" : p < 75 ? "bg-yellow-500" : p < 90 ? "bg-orange-500" : "bg-red-500";

// One rate-limit / token meter row — window label + live/est badge, a capped %
// bar, then the weighted/raw/msgs stat line beneath (mirrors TokenMeter's limit
// windows: bar on top, stats below).
function Meter({ m }: { m: UsageMeter }) {
  const live = m.source === "live";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-300">{m.label}</span>
        <span
          title={
            live
              ? "live — Claude Code's real rate-limit window"
              : "estimate — calibrated from local transcripts (no live snapshot yet)"
          }
          className={`flex items-center gap-1 font-mono text-[8px] uppercase tracking-wider ${
            live ? "text-green-400" : "text-zinc-600"
          }`}
        >
          <span className={`size-1.5 rounded-full ${live ? "bg-green-400" : "bg-zinc-600"}`} />
          {live ? "live" : "est"}
        </span>
        {!m.calibrated && (
          <span
            title="limit is an uncalibrated estimate — the real Opus weekly cap lives in API headers, off disk"
            className="rounded bg-zinc-800/60 px-1 py-px font-mono text-[8px] uppercase tracking-wider text-zinc-500"
          >
            est. cap
          </span>
        )}
      </div>

      <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${pctBar(m.rawPct)}`}
          style={{ width: `${m.pct}%` }}
        />
      </div>

      <span className="font-mono text-xs text-zinc-500">
        <span className={pctText(m.rawPct)}>{Math.round(m.rawPct)}%</span>
        {" · "}
        {fmt(m.usedWeighted)} weighted · {fmt(m.rawTokens)} raw · {m.messages} msgs
        {m.resetsAt != null && <> · resets {clock(m.resetsAt)}</>}
      </span>
    </div>
  );
}

export default function UsagePanel() {
  const { open, setOpen } = useUsage();
  const [data, setData] = useState<UsageStates | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const aborter = useRef<AbortController | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setErr(null);
    }
    aborter.current?.abort();
    const ac = new AbortController();
    aborter.current = ac;
    try {
      const r = await fetch("/api/usage", { cache: "no-store", signal: ac.signal });
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e) {
      if (!ac.signal.aborted && !silent) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Load on open + a 15s live poll while open (mirrors ApiPanel / the route's
  // force-dynamic freshness); abort + clear on close.
  useEffect(() => {
    if (!open) return;
    load();
    const id = setInterval(() => load(true), 15000);
    return () => {
      clearInterval(id);
      aborter.current?.abort();
    };
  }, [open, load]);

  const f = data?.forecast;
  // Forecast geometry — mirrors ForecastMeter: used (solid) + projected-by-reset
  // (faint), with a NOW marker at the head of the current fill.
  let usedPct = 0;
  let projPct = 0;
  if (f) {
    const mins = Math.max((f.blockReset - Date.now()) / 60000, 0);
    usedPct = Math.min((f.blockWeighted / f.limit) * 100, 100);
    projPct = Math.min(((f.blockWeighted + f.burnPerMin * mins) / f.limit) * 100, 100);
  }

  return (
    <AppPanel
      rootId="usage-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="usage-panel.tsx">
        {/* header — label + refresh */}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-600">
            usage
            {data?.snapshotAt ? (
              <span className="text-green-400" title={`live snapshot captured ${clock(data.snapshotAt)}`}>
                · live
              </span>
            ) : (
              <span>· modeled</span>
            )}
          </span>
          <button
            onClick={() => load()}
            disabled={loading}
            title="Refresh usage"
            aria-label="Refresh usage"
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

        {!data ? (
          <p className="font-mono text-[11px] text-zinc-600">{loading ? "loading…" : "—"}</p>
        ) : (
          <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {/* ── METERS — the live rate-limit / token windows ── */}
            <div className="flex flex-col gap-4">
              {data.meters.map((m) => (
                <Meter key={m.key} m={m} />
              ))}
            </div>

            {/* ── BURN FORECAST — set apart from the windows above ── */}
            {f && (
              <div className="mt-2 flex flex-col gap-1.5 border-t border-zinc-800 pt-6">
                <span className="text-sm text-zinc-300">Burn forecast · 5h block</span>

                {/* timeline track: used (solid) + projected-by-reset (faint) + NOW marker */}
                <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-orange-500/25 transition-[width] duration-500"
                    style={{ width: `${projPct}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-orange-500 transition-[width] duration-500"
                    style={{ width: `${usedPct}%` }}
                  />
                  <div className="absolute inset-y-0 w-px bg-zinc-100" style={{ left: `${usedPct}%` }} />
                </div>

                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 font-mono text-xs text-zinc-500">
                  <span>
                    now <span className="text-zinc-300">{fmt(f.blockWeighted)}</span> / {fmt(f.limit)} ·{" "}
                    {Math.round(usedPct)}%
                  </span>
                  <span>
                    by {clock(f.blockReset)}: <span className="text-orange-300">~{Math.round(projPct)}%</span>
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-orange-500" /> used now
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-orange-500/25" /> projected by reset
                  </span>
                </div>
              </div>
            )}

            {/* the fine print, condensed — one readable footer, pinned to the bottom */}
            <p className="mt-auto border-t border-dashed border-zinc-800 pt-3 text-xs leading-relaxed text-zinc-600">
              Token totals are metered from your local Claude&nbsp;Code transcripts, weighted by
              cost (cache reads ×0.1, output ×5) and model tier (Opus ×5). The rate-limit&nbsp;% is
              read straight from Claude&nbsp;Code when marked{" "}
              <span className="text-green-400">live</span>, a calibrated estimate otherwise. Burn
              projects your last 15&nbsp;minutes of pace to the 5&nbsp;AM reset — a guide, not a bill.
            </p>
          </div>
        )}
      </Boundary>
    </AppPanel>
  );
}
