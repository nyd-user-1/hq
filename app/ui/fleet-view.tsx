"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FleetMetrics, Shape, Stat, Tone } from "@/lib/fleet";
import FleetGrid from "@/app/ui/fleet-grid";
import SessionMenu from "@/app/ui/session-menu";
import TerminalNavMenu from "@/app/ui/terminal-nav-menu";
import { DRAG_TYPE } from "@/app/ui/kpi-panel";
import { useKpis, RECOMMENDED_VIEWS, type SavedView } from "@/app/ui/kpi-state";

// THE FLEET — hq's command deck on the terminal.tsx shell. Header (● project ·
// sessions · ⋮ panels · ⟲ reset · 💾 views · ⤢) over the dashboard GRID. The metric
// LIBRARY is the root kpi-panel (⋮→Metrics→KPIs); drag cards onto the board. Charts
// carry a PORTAL tooltip (escapes the card clip) on hover. Scope = project + multi-
// select sessions; placed set + saved views persist via kpi-state.

const INK: Record<Tone, string> = { blue: "#60a5fa", orange: "#fb923c", green: "#4ade80", amber: "#fbbf24", red: "#f87171", zinc: "#a1a1aa" };
const BRIGHT: Record<Tone, string> = { blue: "#93c5fd", orange: "#fdba74", green: "#86efac", amber: "#fcd34d", red: "#fca5a5", zinc: "#e4e4e7" };
const BAR: Record<Tone, string> = { blue: "bg-blue-500/60", orange: "bg-orange-500/55", green: "bg-emerald-500/55", amber: "bg-amber-500/60", red: "bg-red-500/60", zinc: "bg-zinc-600" };
const KPI_TXT: Record<Tone, string> = { blue: "text-blue-400", orange: "text-orange-400", green: "text-emerald-400", amber: "text-amber-400", red: "text-red-400", zinc: "text-zinc-100" };

const fmtNum = (n: number): string =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));
const fmtDur = (ms: number): string => {
  const s = ms / 1000;
  if (s < 60) return Math.round(s) + "s";
  const m = s / 60;
  if (m < 60) return Math.round(m) + "m";
  const h = m / 60;
  return h < 24 ? h.toFixed(1) + "h" : Math.round(h / 24) + "d";
};

// ── the shared chart tooltip — a fixed chip portaled to <body> so it floats over
// the card edges (the old in-card chip clipped against overflow-hidden). ──
type Tip = { x: number; y: number; node: React.ReactNode } | null;
function TipLayer({ tip }: { tip: Tip }) {
  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] leading-tight text-zinc-200 shadow-xl"
      style={{ left: tip.x, top: tip.y - 10 }}
    >
      {tip.node}
    </div>,
    document.body,
  );
}
const tipRow = (label: React.ReactNode, value: React.ReactNode) => (
  <>
    <div className="text-zinc-400">{label}</div>
    <div className="tabular-nums">{value}</div>
  </>
);

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

function LineChart({ shape, strong }: { shape: Extract<Shape, { kind: "series" | "area" }>; strong: boolean }) {
  const tone = shape.tone ?? "zinc";
  const ink = INK[tone];
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip>(null);
  const pts = shape.points;
  const n = pts.length;
  const max = Math.max(1, ...pts);
  const W = 300;
  const H = 70;
  const xy = pts.map((p, i) => [n > 1 ? (i / (n - 1)) * W : 0, H - (p / max) * (H - 6) - 3] as [number, number]);
  const line = smoothPath(xy);
  const areaD = line ? `${line} L${W},${H} L0,${H} Z` : "";
  const gid = `flg-${tone}-${strong ? "s" : "l"}`;
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || n < 2) return;
    const idx = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
    setHover(idx);
    setTip({ x: e.clientX, y: e.clientY, node: tipRow(shape.labels?.[idx] ?? `#${idx + 1}`, fmtNum(pts[idx])) });
  };
  const leave = () => {
    setHover(null);
    setTip(null);
  };
  const hx = hover != null && n > 1 ? (hover / (n - 1)) * 100 : 0;
  const hyPct = hover != null ? (xy[hover][1] / H) * 100 : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={ref} className="relative min-h-0 w-full flex-1" onMouseMove={onMove} onMouseLeave={leave}>
        <svg viewBox="0 0 300 70" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ink} stopOpacity={strong ? 0.45 : 0.26} />
              <stop offset="100%" stopColor={ink} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaD} fill={`url(#${gid})`} />
          <path d={line} fill="none" stroke={ink} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {hover != null && (
          <>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-zinc-700/60" style={{ left: `${hx}%` }} />
            <div className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-950" style={{ left: `${hx}%`, top: `${hyPct}%`, background: BRIGHT[tone] }} />
          </>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-zinc-600">
        <span>{shape.capL}</span>
        <span>{shape.capR}</span>
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}

function RankingBody({ shape }: { shape: Extract<Shape, { kind: "ranking" }> }) {
  const [tip, setTip] = useState<Tip>(null);
  if (!shape.rows.length) return <p className="text-[10px] text-zinc-600">—</p>;
  return (
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
      {shape.rows.map((r) => (
        <div
          key={r.name}
          className="grid grid-cols-[64px_1fr_48px] items-center gap-2 text-[10px]"
          onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: tipRow(r.name, r.value) })}
          onMouseLeave={() => setTip(null)}
        >
          <span className="truncate text-zinc-300">{r.name}</span>
          <span className="h-2 overflow-hidden rounded bg-zinc-800">
            <i className={`block h-full rounded ${BAR[shape.tone ?? "zinc"]}`} style={{ width: `${r.pct}%` }} />
          </span>
          <span className="text-right text-zinc-500">{r.value}</span>
        </div>
      ))}
      <TipLayer tip={tip} />
    </div>
  );
}

function DistBody({ shape }: { shape: Extract<Shape, { kind: "distribution" }> }) {
  const [tip, setTip] = useState<Tip>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-end gap-1">
        {shape.bins.map((b, i) => (
          <span
            key={i}
            className={`flex-1 rounded-t ${b.hot ? "bg-amber-500/70" : BAR[shape.tone ?? "zinc"]}`}
            style={{ height: `${Math.max(3, b.h)}%` }}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: tipRow(`bin ${i + 1}${b.hot ? " · premium" : ""}`, `${b.h}%`) })}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-zinc-600">
        <span>{shape.xL}</span>
        <span>{shape.xR}</span>
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}

function ScatterBody({ shape }: { shape: Extract<Shape, { kind: "scatter" }> }) {
  const ink = INK[shape.tone ?? "zinc"];
  const [tip, setTip] = useState<Tip>(null);
  const maxX = Math.max(1, ...shape.pts.map((p) => p.x));
  const maxY = Math.max(1, ...shape.pts.map((p) => p.y));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 w-full flex-1">
        {shape.pts.map((p, i) => (
          <span
            key={i}
            className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${(p.x / maxX) * 96 + 2}%`, top: `${100 - (p.y / maxY) * 94 - 3}%`, background: ink, opacity: 0.55 }}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: tipRow(p.label ?? "session", `${p.x} ${shape.xL} · ${fmtNum(p.y)} ${shape.yL}`) })}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-zinc-600">
        <span>{shape.xL} →</span>
        <span>↑ {shape.yL}</span>
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}

function HeatBody({ shape }: { shape: Extract<Shape, { kind: "heatmap" }> }) {
  const ink = INK[shape.tone ?? "zinc"];
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(1, ...shape.grid.flat());
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="grid min-h-0 flex-1 gap-0.5" style={{ gridTemplateColumns: `repeat(${shape.cols.length}, minmax(0,1fr))` }}>
        {shape.grid.map((row, r) =>
          row.map((v, c) => (
            <span
              key={`${r}-${c}`}
              className="rounded-[1px]"
              style={{ background: ink, opacity: v ? 0.15 + 0.85 * (v / max) : 0.04 }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: tipRow(`${shape.rows[r]} ${c}:00`, `${v} sessions`) })}
              onMouseLeave={() => setTip(null)}
            />
          )),
        )}
      </div>
      <div className="flex justify-between text-[9px] text-zinc-600">
        <span>{shape.cols[0]}</span>
        <span>23h</span>
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}

function StackedBody({ shape }: { shape: Extract<Shape, { kind: "stacked" }> }) {
  const [tip, setTip] = useState<Tip>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-3">
      <div className="flex h-4 w-full overflow-hidden rounded bg-zinc-800">
        {shape.segs.filter((s) => s.pct > 0).map((s, i) => (
          <span
            key={i}
            className={BAR[s.tone ?? "zinc"]}
            style={{ width: `${s.pct}%` }}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: tipRow(s.name, s.value) })}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px]">
        {shape.segs.map((s, i) => (
          <span key={i} className="flex items-center gap-1 text-zinc-400">
            <i className={`size-2 rounded-sm ${BAR[s.tone ?? "zinc"]}`} />
            {s.name} {s.value}
          </span>
        ))}
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}

function StackedAreaBody({ shape }: { shape: Extract<Shape, { kind: "stackedArea" }> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const days = shape.dayLabels.length;
  const W = 300;
  const H = 70;
  // overlapping spline areas — each series from the baseline (not cumulative), on a
  // shared scale, biggest total in back so smaller ones layer on top (the reference
  // look). Smooth top edge + a vertical gradient fill, like the line chart.
  const max = Math.max(1, ...shape.series.flatMap((s) => s.points));
  const X = (i: number) => (days > 1 ? (i / (days - 1)) * W : 0);
  const Y = (v: number) => H - (v / max) * (H - 4) - 2;
  const ordered = [...shape.series]
    .map((s) => ({ s, total: s.points.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
    .map(({ s }) => s);
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || days < 1) return;
    const idx = Math.max(0, Math.min(days - 1, Math.round(((e.clientX - r.left) / r.width) * (days - 1))));
    setTip({
      x: e.clientX,
      y: e.clientY,
      node: (
        <>
          <div className="text-zinc-400">{shape.dayLabels[idx]}</div>
          {shape.series.filter((s) => (s.points[idx] || 0) > 0).map((s) => (
            <div key={s.name} className="flex items-center gap-1.5 tabular-nums">
              <i className="size-1.5 rounded-sm" style={{ background: INK[s.tone ?? "zinc"] }} />
              {s.name} {fmtNum(s.points[idx] || 0)}
            </div>
          ))}
        </>
      ),
    });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={ref} className="relative min-h-0 w-full flex-1" onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
        <svg viewBox="0 0 300 70" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
          <defs>
            {ordered.map((s) => {
              const tone = s.tone ?? "zinc";
              return (
                <linearGradient key={s.name} id={`sa-${tone}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={INK[tone]} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={INK[tone]} stopOpacity="0.03" />
                </linearGradient>
              );
            })}
          </defs>
          {ordered.map((s, i) => {
            const tone = s.tone ?? "zinc";
            const xy = s.points.map((p, j) => [X(j), Y(p)] as [number, number]);
            const line = smoothPath(xy);
            return (
              <g key={i}>
                <path d={`${line} L${W},${H} L0,${H} Z`} fill={`url(#sa-${tone})`} />
                <path d={line} fill="none" stroke={INK[tone]} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-zinc-600">
        <span>{shape.capL}</span>
        <span>{shape.capR}</span>
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}

function SparkBody({ shape }: { shape: Extract<Shape, { kind: "sparkline" }> }) {
  const [tip, setTip] = useState<Tip>(null);
  if (!shape.rows.length) return <p className="text-[10px] text-zinc-600">—</p>;
  return (
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      {shape.rows.map((r) => {
        const W = 80;
        const Hh = 16;
        const max = Math.max(1, ...r.points);
        const xy = r.points.map((p, i) => [r.points.length > 1 ? (i / (r.points.length - 1)) * W : 0, Hh - (p / max) * (Hh - 2) - 1] as [number, number]);
        return (
          <div
            key={r.name}
            className="grid grid-cols-[70px_1fr_48px] items-center gap-2 text-[10px]"
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: tipRow(r.name, r.value) })}
            onMouseLeave={() => setTip(null)}
          >
            <span className="truncate text-zinc-300">{r.name}</span>
            <svg viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" className="h-4 w-full" aria-hidden>
              <path d={smoothPath(xy)} fill="none" stroke={INK.blue} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="text-right text-zinc-500">{r.value}</span>
          </div>
        );
      })}
      <TipLayer tip={tip} />
    </div>
  );
}

function TableBody({ shape }: { shape: Extract<Shape, { kind: "table" }> }) {
  return (
    <div className="scrollbar-none min-h-0 flex-1 overflow-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-zinc-600">
            {shape.cols.map((c) => (
              <th key={c} className="px-1 py-0.5 text-left font-normal uppercase tracking-wider">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shape.rows.map((r, i) => (
            <tr key={i} className="border-t border-zinc-800/60 text-zinc-300 transition-colors hover:bg-zinc-900/60">
              {r.map((cell, j) => (
                <td key={j} className="truncate px-1 py-0.5 font-mono">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalendarBody({ shape }: { shape: Extract<Shape, { kind: "calendar" }> }) {
  const ink = INK[shape.tone ?? "zinc"];
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(1, ...shape.cells);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-1">
        {shape.cells.map((v, i) => (
          <span
            key={i}
            className="rounded-sm"
            style={{ background: ink, opacity: v ? 0.2 + 0.8 * (v / max) : 0.05 }}
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: tipRow(`day ${i + 1}`, `${v} sessions`) })}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-zinc-600">
        <span>{shape.capL}</span>
        <span>{shape.capR}</span>
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}

function BoxBody({ shape }: { shape: Extract<Shape, { kind: "box" }> }) {
  const f = shape.fmt === "dur" ? fmtDur : fmtNum;
  const max = Math.max(1, shape.max);
  const pct = (v: number) => (v / max) * 100;
  const tone = shape.tone ?? "zinc";
  const ink = INK[tone];
  const [tip, setTip] = useState<Tip>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-2">
      <div
        className="relative h-6"
        onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: <div className="tabular-nums">min {f(shape.min)} · q1 {f(shape.q1)} · med {f(shape.med)} · q3 {f(shape.q3)} · max {f(shape.max)}</div> })}
        onMouseLeave={() => setTip(null)}
      >
        <div className="absolute top-1/2 h-px -translate-y-1/2 bg-zinc-600" style={{ left: `${pct(shape.min)}%`, width: `${pct(shape.max) - pct(shape.min)}%` }} />
        <div className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border" style={{ left: `${pct(shape.q1)}%`, width: `${Math.max(1, pct(shape.q3) - pct(shape.q1))}%`, background: `${ink}33`, borderColor: ink }} />
        <div className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2" style={{ left: `${pct(shape.med)}%`, background: BRIGHT[tone] }} />
      </div>
      <div className="flex justify-between text-[9px] text-zinc-600">
        <span>{f(shape.min)}</span>
        <span>med {f(shape.med)}</span>
        <span>{f(shape.max)}</span>
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}

function TimelineBody({ shape }: { shape: Extract<Shape, { kind: "timeline" }> }) {
  const ink = INK[shape.tone ?? "zinc"];
  const [tip, setTip] = useState<Tip>(null);
  const span = Math.max(1, shape.endMs - shape.startMs);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-zinc-800" />
        {shape.items.map((it, i) => {
          const left = Math.max(0, Math.min(100, ((it.at - shape.startMs) / span) * 100));
          return (
            <span
              key={i}
              className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${left}%`, top: "50%", background: ink, opacity: 0.6 }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: <div>{it.label}</div> })}
              onMouseLeave={() => setTip(null)}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-zinc-600">
        <span>{shape.capL}</span>
        <span>{shape.capR}</span>
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}

function GanttBody({ shape }: { shape: Extract<Shape, { kind: "gantt" }> }) {
  const [tip, setTip] = useState<Tip>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="scrollbar-none min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {shape.items.map((it, i) => (
          <div
            key={i}
            className="relative h-2.5"
            onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, node: <div>{it.label}</div> })}
            onMouseLeave={() => setTip(null)}
          >
            <div className="absolute h-full rounded-sm" style={{ left: `${it.startPct}%`, width: `${it.widthPct}%`, background: INK[it.tone ?? "blue"], opacity: 0.6 }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-zinc-600">
        <span>{shape.capL}</span>
        <span>{shape.capR}</span>
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}

function ShapeCard({ shape }: { shape: Shape }) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-3">
      <div className="mb-2.5 flex items-baseline gap-2">
        <span className="truncate text-[11px] text-zinc-400">{shape.title}</span>
        <span className="ml-auto rounded border border-zinc-800 px-1.5 text-[8px] uppercase tracking-widest text-zinc-600 transition group-hover/w:opacity-0">{shape.kind}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {shape.kind === "series" && <LineChart shape={shape} strong={false} />}
        {shape.kind === "area" && <LineChart shape={shape} strong={true} />}
        {shape.kind === "ranking" && <RankingBody shape={shape} />}
        {shape.kind === "distribution" && <DistBody shape={shape} />}
        {shape.kind === "scatter" && <ScatterBody shape={shape} />}
        {shape.kind === "heatmap" && <HeatBody shape={shape} />}
        {shape.kind === "stacked" && <StackedBody shape={shape} />}
        {shape.kind === "stackedArea" && <StackedAreaBody shape={shape} />}
        {shape.kind === "sparkline" && <SparkBody shape={shape} />}
        {shape.kind === "table" && <TableBody shape={shape} />}
        {shape.kind === "calendar" && <CalendarBody shape={shape} />}
        {shape.kind === "box" && <BoxBody shape={shape} />}
        {shape.kind === "timeline" && <TimelineBody shape={shape} />}
        {shape.kind === "gantt" && <GanttBody shape={shape} />}
      </div>
    </div>
  );
}

function KpiTile({ k }: { k: Stat }) {
  return (
    <div className="flex h-full flex-col justify-center overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-900/30 px-2.5 py-2">
      <div className="truncate text-[8px] uppercase tracking-widest text-zinc-600">{k.label}</div>
      <div className={`mt-1 text-[19px] leading-none tracking-tight ${KPI_TXT[k.tone ?? "zinc"]}`}>{k.value}</div>
      {k.sub && <div className="mt-1 truncate text-[9px] text-zinc-600">{k.sub}</div>}
    </div>
  );
}

function HoverMenu({ label, labelClass, align = "left", children }: { label: React.ReactNode; labelClass?: string; align?: "left" | "right"; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 180);
  };
  return (
    <div className="relative flex shrink-0 items-center" onMouseEnter={enter} onMouseLeave={leave}>
      <span className={labelClass}>{label}</span>
      {open && <div className={`absolute top-full z-50 mt-1 ${align === "right" ? "right-0" : "left-0"}`}>{children}</div>}
    </div>
  );
}

function ProjectMenu({ projects, value, onPick }: { projects: string[]; value: string | null; onPick: (p: string | null) => void }) {
  // default label reads "hq" (the home project) when no filter is set, per request.
  return (
    <HoverMenu label={value ?? "hq"} labelClass={`cursor-pointer font-mono text-xs transition-colors ${value ? "text-zinc-200 hover:text-white" : "text-zinc-300 hover:text-white"}`}>
      <div className="scrollbar-none flex max-h-[340px] w-56 flex-col overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
        <button type="button" onClick={() => onPick(null)} className={`rounded px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-zinc-900 ${value ? "text-zinc-300" : "text-green-400"}`}>
          All projects
        </button>
        {projects.map((p) => (
          <button key={p} type="button" onClick={() => onPick(p)} className={`truncate rounded px-2 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-zinc-900 ${value === p ? "text-green-400" : "text-zinc-300"}`}>
            {p}
          </button>
        ))}
      </div>
    </HoverMenu>
  );
}

// Save / load board VIEWS — a hover dropdown: name+save, recommended seeds, saved.
function SaveMenu({ current, views, onApply, onSave, onDelete }: { current: string; views: SavedView[]; onApply: (v: SavedView) => void; onSave: (name: string) => void; onDelete: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <HoverMenu
      label={<span title="saved views" className="text-[11px]">{current}</span>}
      labelClass="cursor-pointer rounded px-1 py-0.5 lowercase text-zinc-500 transition-colors hover:text-zinc-300"
      align="left"
    >
      <div className="flex w-60 flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1.5 shadow-xl">
        <div className="flex items-center gap-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                onSave(name);
                setName("");
              }
            }}
            placeholder="Save current as…"
            className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => { onSave(name); setName(""); }}
            className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-40"
          >
            save
          </button>
        </div>
        <div className="px-1 pt-1 text-[9px] uppercase tracking-widest text-zinc-600">Recommended</div>
        {RECOMMENDED_VIEWS.map((v) => (
          <button key={v.name} type="button" onClick={() => onApply(v)} className="truncate rounded px-2 py-1 text-left text-[11px] text-zinc-300 transition-colors hover:bg-zinc-900">
            {v.name} <span className="text-zinc-600">· {v.ids.length}</span>
          </button>
        ))}
        {views.length > 0 && <div className="px-1 pt-1 text-[9px] uppercase tracking-widest text-zinc-600">Saved</div>}
        {views.map((v) => (
          <div key={v.name} className="group flex items-center rounded hover:bg-zinc-900">
            <button type="button" onClick={() => onApply(v)} className="min-w-0 flex-1 truncate px-2 py-1 text-left text-[11px] text-zinc-300">
              {v.name} <span className="text-zinc-600">· {v.ids.length}</span>
            </button>
            <button type="button" onClick={() => onDelete(v.name)} title="delete view" className="px-2 py-1 text-zinc-600 opacity-0 transition hover:text-red-300 group-hover:opacity-100">✕</button>
          </div>
        ))}
      </div>
    </HoverMenu>
  );
}

const STAT_KINDS = new Set(["stat"]);

export default function FleetView() {
  const { open, setOpen, placed, setPlaced, addMetric, removeMetric, setCatalog, project, setProject, sessions, setSessions, views, saveView, deleteView, viewName, applyView } = useKpis();
  const [metrics, setMetrics] = useState<FleetMetrics | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [wide, setWide] = useState(false); // open in FOCUS mode by default

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const qs = new URLSearchParams();
    if (project) qs.set("project", project);
    if (sessions.length) qs.set("sessions", sessions.join(","));
    if (placed && placed.length) qs.set("ids", placed.join(","));
    const url = `/api/fleet/metrics${qs.toString() ? `?${qs}` : ""}`;
    const load = async () => {
      try {
        const d: FleetMetrics = await fetch(url, { cache: "no-store" }).then((r) => r.json());
        if (!alive) return;
        setMetrics(d);
        if (Array.isArray(d?.catalog)) setCatalog(d.catalog);
        if (Array.isArray(d?.projects)) setProjects(d.projects);
        if (placed === null && Array.isArray(d?.items)) setPlaced(d.items.map((i) => i.id));
      } catch {
        /* keep last canvas on a blip */
      } finally {
        if (alive) timer = setTimeout(load, 8000);
      }
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [project, sessions, placed, setCatalog, setPlaced]);

  const toggleSession = (id: string) => setSessions(sessions.includes(id) ? sessions.filter((s) => s !== id) : [...sessions, id]);
  const sessionLabel = sessions.length === 0 ? "all sessions" : sessions.length === 1 ? sessions[0].slice(0, 8) : `${sessions.length} sessions`;
  // focus width = the terminal's exact centered column (max-w-3xl px-4), so the
  // dashboard's focus mode matches a session's. Applied to BOTH header and board.
  const colWrap = wide ? "" : "mx-auto w-full max-w-3xl px-4";

  const gridItems = (metrics?.items ?? []).map((it) => {
    const stat = STAT_KINDS.has(it.kind);
    return {
      id: it.id,
      w: stat ? 2 : 6,
      h: stat ? 3 : 8,
      minW: stat ? 1 : 2,
      node: (
        <div className="relative h-full">
          {stat && it.stat ? <KpiTile k={it.stat} /> : it.shape ? <ShapeCard shape={it.shape} /> : null}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); removeMetric(it.id); }}
            title="remove from board"
            className="absolute left-1 top-1 z-30 rounded p-0.5 text-zinc-500 opacity-0 transition hover:bg-zinc-800 hover:text-red-300 group-hover/w:opacity-100"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ),
    };
  });

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-3 font-mono">
      {/* header */}
      <div className={`mb-1 ${colWrap}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 pb-3">
          {/* dot + project, grouped tight like the terminal header (no "·" between
              project and session id) */}
          <span className="flex shrink-0 items-center gap-1.5 text-xs">
            <span className="size-2 rounded-full bg-green-500" title="fleet dashboard — live data" />
            <ProjectMenu projects={projects} value={project} onPick={setProject} />
          </span>
          <SessionMenu currentId={sessions[0] ?? null} selected={sessions} onToggle={toggleSession} onClear={() => setSessions([])}>
            <span
              title="sessions — hover to select one or many"
              className={`cursor-pointer rounded px-1 py-0.5 text-[11px] transition-colors ${sessions.length ? "text-green-400 hover:text-green-300" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {sessionLabel}
            </span>
          </SessionMenu>
          {/* ⋮ panels nav — Metrics → KPIs opens the library */}
          <TerminalNavMenu project={project ?? ""} sessionId={sessions[0] ?? null} />
          {/* refresh — just right of the kebab */}
          <button type="button" onClick={() => window.dispatchEvent(new Event("hq:fleet-grid-reset"))} title="reset the dashboard layout" className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setWide((v) => !v)} title={wide ? "focus width" : "widescreen"} className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 3h6v6" />
                <path d="M9 21H3v-6" />
                <path d="M21 3l-7 7" />
                <path d="M3 21l7-7" />
              </svg>
            </button>
          </span>
        </div>
        {/* view bar — the view name (lowercase, saved-views dropdown) on the left;
            a panel-right toggle for the KPI library on the right */}
        <div className="mt-2 flex items-center justify-between">
          <SaveMenu current={viewName} views={views} onApply={applyView} onSave={saveView} onDelete={deleteView} />
          {/* lucide panel-right-open / panel-right-close — toggles the KPI library */}
          <button type="button" onClick={() => setOpen(!open)} title={open ? "close the KPI panel" : "open the KPI panel"} className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M15 3v18" />
              {open ? <path d="m10 15-3-3 3-3" /> : <path d="m8 9 3 3-3 3" />}
            </svg>
          </button>
        </div>
      </div>

      {/* body — the board (full-height drop target) */}
      <div
        className={`scrollbar-none min-h-0 flex-1 overflow-y-auto ${colWrap}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(DRAG_TYPE) || e.dataTransfer.getData("text/plain");
          if (id) {
            e.preventDefault();
            addMetric(id);
          }
        }}
      >
        {!metrics ? (
          <p className="text-[10px] text-zinc-600">loading metrics…</p>
        ) : gridItems.length === 0 ? (
          <p className="text-[11px] text-zinc-500">
            Empty board — open <b className="font-medium text-zinc-300">⋮ → Metrics → KPIs</b> and drag a card here, or pick a Saved view.
          </p>
        ) : (
          <FleetGrid storageKey="hq-fleet-grid" items={gridItems} />
        )}
      </div>
    </div>
  );
}
