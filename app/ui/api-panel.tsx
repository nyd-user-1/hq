"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useApi } from "@/app/ui/api-state";
import type { UsageStates, UsageMeter, MeterState } from "@/lib/usage";

// The independent API panel — HQ's read of the CLI `/usage` screen. Same restrained
// idiom as TokenMeter/ForecastMeter (zinc track + colored fill, mono micro-captions,
// green→red pct ramp, zinc-divider sections), wrapped in the panel chrome and
// live-polling /api/usage every 15s so the meters tick as the window burns. NB: the
// real /usage windows are read from API rate-limit HEADERS in-process and never hit
// disk — this is HQ's CALIBRATED model of them, not the raw values (see footnote).

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
const fmtDur = (ms: number): string => {
  if (ms <= 0) return "now";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
};

// Continuous pct ramp — the same green→yellow→orange→red TokenMeter uses for its
// % text, reused here for both the % readout and the bar fill so the meter reads
// at a glance.
const pctText = (p: number) =>
  p < 50 ? "text-green-500" : p < 75 ? "text-yellow-500" : p < 90 ? "text-orange-500" : "text-red-500";
const pctBar = (p: number) =>
  p < 50 ? "bg-green-500" : p < 75 ? "bg-yellow-500" : p < 90 ? "bg-orange-500" : "bg-red-500";

const STATE_CHIP: Record<MeterState, { label: string; cls: string }> = {
  ok: { label: "ok", cls: "text-zinc-500 bg-zinc-800/60" },
  approaching: { label: "approaching", cls: "text-orange-300 bg-orange-500/10" },
  reached: { label: "limit reached", cls: "text-red-300 bg-red-500/15" },
};

// Weighted model mix — the /usage "where it came from" breakdown.
const TIER_COLOR: Record<string, string> = {
  Opus: "bg-blue-500",
  Sonnet: "bg-zinc-400",
  Haiku: "bg-zinc-600",
  Fable: "bg-purple-500",
  Mythos: "bg-fuchsia-500",
  Other: "bg-zinc-700",
};
const tierColor = (t: string) => TIER_COLOR[t] ?? "bg-zinc-700";

function Meter({ m }: { m: UsageMeter }) {
  const chip = STATE_CHIP[m.state];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="flex items-center gap-2 text-sm text-zinc-300">
          {m.label}
          {!m.calibrated && (
            <span
              title="limit is an uncalibrated estimate — the real Opus weekly cap lives in API headers, off disk"
              className="rounded bg-zinc-800/60 px-1 py-px font-mono text-[8px] uppercase tracking-wider text-zinc-500"
            >
              est. cap
            </span>
          )}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${chip.cls}`}
        >
          {chip.label}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${pctBar(m.rawPct)}`}
          style={{ width: `${m.pct}%` }}
        />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 font-mono text-[11px] text-zinc-500">
        <span>
          {fmt(m.usedWeighted)} / {fmt(m.limit)} weighted ·{" "}
          <span className={pctText(m.rawPct)}>{Math.round(m.rawPct)}%</span>
        </span>
        <span>
          {m.resetsAt
            ? `resets ${clock(m.resetsAt)} · in ${fmtDur(m.resetsAt - Date.now())}`
            : `${m.span} · ${m.messages} msgs`}
        </span>
      </div>
    </div>
  );
}

export default function ApiPanel() {
  const { open, setOpen } = useApi();
  const [data, setData] = useState<UsageStates | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
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
      setSyncedAt(Date.now());
    } catch (e) {
      if (!ac.signal.aborted && !silent) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

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
    <AppPanel rootId="api-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary label="api-panel.tsx">
        {err && (
          <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
            {err}
          </p>
        )}

        {/* header — live state, synced stamp, refresh */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">
            usage · modeled
          </span>
          <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-600">
            <span>{syncedAt ? `synced ${clock(syncedAt)}` : loading ? "loading…" : ""}</span>
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
        </div>

        {!data ? (
          <p className="mt-2 font-mono text-[11px] text-zinc-600">{loading ? "loading…" : "—"}</p>
        ) : (
          <div className="scrollbar-none mt-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {/* ── METERS — the /usage rows ── */}
            <div className="flex flex-col gap-4">
              {data.meters.map((m) => (
                <Meter key={m.key} m={m} />
              ))}
            </div>

            {/* ── BURN FORECAST — 5h block flow ── */}
            {f && (
              <div className="flex flex-col gap-1.5 border-t border-zinc-800 pt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm text-zinc-300">Burn forecast · 5h block</span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    <span className="text-zinc-300">{fmt(f.burnPerMin)}/min</span>
                    {" · "}
                    {f.underCap ? (
                      <span className="text-green-500">under cap</span>
                    ) : (
                      <span className="text-orange-500">cap {clock(f.projectedCapAt!)}</span>
                    )}
                  </span>
                </div>
                <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-orange-500/25 transition-[width] duration-500"
                    style={{ width: `${projPct}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-orange-500 transition-[width] duration-500"
                    style={{ width: `${usedPct}%` }}
                  />
                  <div
                    className="absolute inset-y-0 w-px bg-zinc-100"
                    style={{ left: `${usedPct}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[11px] text-zinc-500">
                  <span>
                    now <span className="text-zinc-300">{fmt(f.blockWeighted)}</span> ·{" "}
                    {Math.round(usedPct)}%
                  </span>
                  <span>
                    by {clock(f.blockReset)}:{" "}
                    <span className="text-orange-300">~{Math.round(projPct)}%</span>
                  </span>
                </div>
              </div>
            )}

            {/* ── SPEND — session / today / week (est. USD) ── */}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-zinc-800 pt-4 font-mono text-xs">
              <span className="uppercase tracking-wide text-zinc-600">spend</span>
              <span className="text-emerald-300">
                ${data.spend.session.toFixed(2)} <span className="text-zinc-600">session</span>
              </span>
              <span className="text-zinc-300">
                ${data.spend.today.toFixed(2)} <span className="text-zinc-600">today</span>
              </span>
              <span className="text-zinc-300">
                ${data.spend.week.toFixed(2)} <span className="text-zinc-600">week</span>
              </span>
            </div>

            {/* ── MODEL MIX — weighted share over the week ── */}
            {data.byModel.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-zinc-800 pt-4">
                <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">
                  model mix · week
                </span>
                <div className="flex h-2 overflow-hidden rounded-full bg-zinc-900">
                  {data.byModel.map((s) => (
                    <div
                      key={s.tier}
                      className={`${tierColor(s.tier)} transition-[width] duration-500`}
                      style={{ width: `${s.pct}%` }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-500">
                  {data.byModel.map((s) => (
                    <span key={s.tier} className="flex items-center gap-1.5">
                      <span className={`size-2 rounded-full ${tierColor(s.tier)}`} />
                      {s.tier} <span className="text-zinc-400">{Math.round(s.pct)}%</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── INSIGHTS — where the weekly burn concentrates ── */}
            <div className="flex flex-col gap-1 border-t border-zinc-800 pt-4">
              <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">
                breakdown · week
              </span>
              {data.insights.map((ins) => (
                <div key={ins.key} className="flex items-baseline gap-2 font-mono text-[11px]">
                  <span className="w-10 shrink-0 text-right text-zinc-300">
                    {Math.round(ins.pct)}%
                  </span>
                  <span className="text-zinc-500">{ins.label}</span>
                </div>
              ))}
            </div>

            {/* ── FOOTNOTE — the honest provenance ── */}
            <p className="border-t border-dashed border-zinc-800 pt-3 text-xs leading-relaxed text-zinc-600">
              modeled from local transcripts — the live /usage windows are read from
              API rate-limit headers in-process and never hit disk, so these are HQ&apos;s
              calibrated estimate, not the raw values. weighted = input-equivalents
              (cache read ×0.1, output ×5) × per-model tier (opus ×5). session/week
              limits calibrated to /usage 2026-06-11; Opus weekly cap uncalibrated.
            </p>
          </div>
        )}
      </Boundary>
    </AppPanel>
  );
}
