"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MetricItem, Shape, Tone } from "@/lib/fleet";
import { ShapeCard } from "@/app/ui/fleet-view";
import { useInView } from "./use-in-view";

// Parse a formatted stat ("55.3M", "$7.5k", "4,418", "26%", "48") into its animatable
// parts so the number can count up while the prefix/suffix ($, %, M, k…) hold steady.
// Returns null for non-numeric values ("—") — those render verbatim, no count-up.
function parseStat(v: string) {
  const m = v.match(/^(\D*?)([\d,]+(?:\.\d+)?)(\D*)$/);
  if (!m) return null;
  const digits = m[2].replace(/,/g, "");
  const num = parseFloat(digits);
  if (!isFinite(num)) return null;
  const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
  return { prefix: m[1], num, suffix: m[3], decimals, grouped: m[2].includes(",") };
}

function fmtStat(n: number, p: NonNullable<ReturnType<typeof parseStat>>) {
  const body = p.grouped
    ? n.toLocaleString("en-US", { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })
    : n.toFixed(p.decimals);
  return `${p.prefix}${body}${p.suffix}`;
}

// The stat value, counting up 0→target (easeOutCubic, ~0.9s) the first time it scrolls
// into view. Later updates (poll / range change) just swap in the new value.
function CountUp({ value, className }: { value: string; className?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const parsed = useMemo(() => parseStat(value), [value]);
  const [disp, setDisp] = useState(() => (parsed ? fmtStat(0, parsed) : value));
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) {
      setDisp(value); // already animated — show latest, don't replay
      return;
    }
    if (!inView || !parsed) return;
    ran.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisp(value);
      return;
    }
    const dur = 900;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setDisp(fmtStat(parsed.num * e, parsed));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, parsed, value]);

  return (
    <span ref={ref} className={className}>
      {parsed ? disp : value}
    </span>
  );
}

// ── landing-only fake data ────────────────────────────────────────────────────
// The "/" analytics board is a product SHOT, not the live view. Real per-model /
// per-session token history is often sparse, so the two stacked charts get
// hand-shaped fake series (real dates + structure kept; only the values swapped).
// This lives here, NOT in lib/fleet.ts, so the real Fleet dashboard stays honest.
const INK: Record<string, string> = { green: "#4ade80", blue: "#60a5fa", orange: "#fb923c", amber: "#fbbf24", red: "#f87171", zinc: "#a1a1aa" };

// a smooth gaussian bump: center/width as fractions of the span so it adapts to n
function hump(n: number, cFrac: number, wFrac: number, h: number): number[] {
  const c = cFrac * (n - 1);
  const w = Math.max(2, wFrac * n);
  return Array.from({ length: n }, (_, i) => {
    const z = (i - c) / w;
    return Math.round(h * Math.exp(-z * z));
  });
}
const flat = (n: number, v: number) => Array.from({ length: n }, () => v);
const blend = (...arrs: number[][]): number[] =>
  Array.from({ length: arrs[0]?.length ?? 0 }, (_, i) => Math.max(0, arrs.reduce((s, a) => s + (a[i] ?? 0), 0)));

// broad, full-width layered plateaus — reads well at any window
function fakeModelSeries(n: number): { name: string; tone: Tone; points: number[] }[] {
  return [
    { name: "Opus", tone: "orange", points: blend(hump(n, 0.5, 0.42, 30000), flat(n, 15000)) },
    { name: "Sonnet", tone: "blue", points: blend(hump(n, 0.58, 0.32, 16000), flat(n, 4000)) },
    { name: "Haiku", tone: "green", points: blend(hump(n, 0.42, 0.38, 8000), flat(n, 2000)) },
    { name: "Fable", tone: "red", points: hump(n, 0.78, 0.13, 6000) },
  ];
}
// islands spread across the whole span (incl. recent) so 7/30-day windows stay full
function fakeSessionSeries(n: number): { name: string; tone: Tone; points: number[] }[] {
  return [
    { name: "a1f4c2e8", tone: "green", points: hump(n, 0.08, 0.035, 22000) },
    { name: "b7d9e3a1", tone: "orange", points: hump(n, 0.24, 0.06, 50000) },
    { name: "c3e8f1b6", tone: "red", points: hump(n, 0.4, 0.065, 27000) },
    { name: "d5a2c9f4", tone: "amber", points: hump(n, 0.6, 0.075, 30000) },
    { name: "e9b6d4a7", tone: "blue", points: hump(n, 0.82, 0.06, 24000) },
    { name: "f2c7a5d3", tone: "zinc", points: hump(n, 0.94, 0.045, 16000) },
  ];
}

// ── global range filter (the header "live" control) ───────────────────────────
// Reshapes every card: charts window to the last N days, stats scale by a factor.
// A demo control — "just needs to look" alive.
export type GlobalRange = "live" | "7" | "30" | "90";
export const GLOBAL_RANGES: [GlobalRange, string][] = [
  ["live", "Live"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
];
const RANGE_CFG: Record<GlobalRange, { n: number | null; f: number }> = {
  live: { n: null, f: 1 },
  "7": { n: 7, f: 0.18 },
  "30": { n: 30, f: 0.5 },
  "90": { n: 90, f: 1 },
};

function windowShape(shape: Shape, n: number | null): Shape {
  if (n == null) return shape;
  if (shape.kind === "series" || shape.kind === "area") {
    const labels = shape.labels?.slice(-n);
    return { ...shape, points: shape.points.slice(-n), labels, capL: labels?.[0] ?? shape.capL };
  }
  if (shape.kind === "stackedArea") {
    const dayLabels = shape.dayLabels.slice(-n);
    return { ...shape, dayLabels, capL: dayLabels[0] ?? shape.capL, series: shape.series.map((s) => ({ ...s, points: s.points.slice(-n) })) };
  }
  return shape;
}

function scaleStatValue(value: string, f: number): string {
  const p = parseStat(value);
  if (!p) return value;
  return fmtStat(Math.max(0, p.num * f), p);
}

// swap in the fake series, then apply the global range (window + scale)
function prepare(items: MetricItem[], range: GlobalRange): MetricItem[] {
  const { n, f } = RANGE_CFG[range];
  return items.map((it) => {
    let shape = it.shape;
    if (shape?.kind === "stackedArea") {
      if (it.id === "tokens_stacked_area") shape = { ...shape, series: fakeModelSeries(shape.dayLabels.length) };
      else if (it.id === "tokens_by_session_area") shape = { ...shape, series: fakeSessionSeries(shape.dayLabels.length) };
    }
    if (shape) shape = windowShape(shape, n);
    const stat = it.stat && f !== 1 ? { ...it.stat, value: scaleStatValue(it.stat.value, f) } : it.stat;
    return { ...it, shape, stat };
  });
}

// ── stat tiles ────────────────────────────────────────────────────────────────
const TONE: Record<string, string> = {
  green: "text-green-400",
  blue: "text-blue-400",
  orange: "text-orange-400",
  amber: "text-amber-400",
  red: "text-red-400",
  zinc: "text-zinc-50",
};

// fake trend sparklines + deltas per tile (a demo shot — pure decoration)
const SPARKS = [
  [4, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16],
  [12, 11, 13, 10, 12, 14, 13, 16, 15, 18, 17, 20],
  [6, 8, 7, 9, 11, 10, 13, 12, 15, 14, 17, 18],
  [5, 5, 6, 7, 6, 8, 9, 8, 10, 11, 10, 12],
  [9, 8, 10, 7, 9, 6, 8, 5, 7, 6, 4, 5],
  [7, 9, 8, 11, 10, 12, 11, 13, 12, 14, 13, 15],
];
const DELTAS: { v: string; up: boolean }[] = [
  { v: "12%", up: true },
  { v: "8%", up: true },
  { v: "15%", up: true },
  { v: "3%", up: true },
  { v: "5%", up: false },
  { v: "2%", up: true },
];

function Sparkline({ points, color, className }: { points: number[]; color: string; className?: string }) {
  const W = 100;
  const H = 24;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const rng = max - min || 1;
  const d = points
    .map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * W).toFixed(1)},${(H - ((p - min) / rng) * (H - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={color} fillOpacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ShotStat({ value, label, tone, idx }: { value: string; label?: string; tone?: string; idx: number }) {
  const spark = SPARKS[idx % SPARKS.length];
  const delta = DELTAS[idx % DELTAS.length];
  const ink = INK[tone ?? "zinc"] ?? INK.zinc;
  return (
    <div className="group relative flex h-[64px] flex-col justify-start overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-900/30 px-4 pt-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60">
      <div className="relative z-[1] flex items-start justify-between gap-2">
        <CountUp value={value} className={`text-[24px] leading-none tracking-tight ${TONE[tone ?? "zinc"] ?? TONE.zinc}`} />
        <div className="flex flex-col items-end gap-1">
          {label && <span className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</span>}
          <span className={`font-mono text-[10px] ${delta.up ? "text-emerald-400" : "text-red-400"}`}>
            {delta.up ? "▲" : "▼"} {delta.v}
          </span>
        </div>
      </div>
      <Sparkline
        points={spark}
        color={ink}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-7 opacity-30 transition-opacity duration-300 group-hover:opacity-70"
      />
    </div>
  );
}

// The fixed board layout for the landing's analytics dashboard section — the
// preferred Analytics view, laid out like the real dashboard but without the
// drag/resize/persist machinery (this is a product shot, not a workspace).
// Cells are the REAL ShapeCard components, so tooltips, the range picker, and
// the rAF path-morph all work.
export default function DashboardBoard({ items, range = "live" }: { items: MetricItem[]; range?: GlobalRange }) {
  const prepared = useMemo(() => prepare(items, range), [items, range]);
  const by = useMemo(() => new Map(prepared.map((it) => [it.id, it])), [prepared]);
  const stat = (id: string, idx: number) => {
    const it = by.get(id);
    return it?.stat ? <ShotStat value={it.stat.value} label={it.stat.label} tone={it.stat.tone} idx={idx} /> : null;
  };
  const shape = (id: string) => {
    const it = by.get(id);
    return it?.shape ? <ShapeCard shape={it.shape} /> : null;
  };
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="grid shrink-0 grid-cols-3 gap-3">
        {stat("f_sessions", 0)}
        {stat("f_tokens", 1)}
        {stat("f_turns", 2)}
        {stat("f_projects", 3)}
        {stat("todos_pending", 4)}
        {stat("f_cliff", 5)}
      </div>
      <div className="min-h-0 flex-[1.1]">{shape("tokens_by_session_area")}</div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        {shape("tokens_day_area")}
        {shape("tokens_stacked_area")}
      </div>
    </div>
  );
}
