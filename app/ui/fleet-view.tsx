"use client";

import { useEffect, useRef, useState } from "react";
import type { FleetMetrics, Shape, Stat, Tone } from "@/lib/fleet";
import FleetGrid from "@/app/ui/fleet-grid";
import SessionMenu from "@/app/ui/session-menu";
import TerminalNavMenu from "@/app/ui/terminal-nav-menu";
import { DRAG_TYPE } from "@/app/ui/kpi-panel";
import { useKpis } from "@/app/ui/kpi-state";

// THE FLEET — hq's command deck on the terminal.tsx shell: a HEADER row (● project
// picker · session picker · ⋮ panels · ⤢) over the dashboard GRID (the board). The
// metric LIBRARY is the root-level kpi-panel (open via the ⋮ Metrics→KPIs leaf);
// drag a card onto the board. Scope = a PROJECT filter + a MULTI-SELECT of sessions
// (0 = all, 1 = session grain, >1 = aggregate); shared via kpi-state so the panel
// and the board agree. Charts: gradient+rounded line/area with a hover dot+tooltip,
// ranking, distribution, scatter, heatmap. Placed set persists; polls metrics ~8s.

// SEMANTIC ink + a brighter tint for hover dots (a touch more contrast).
const INK: Record<Tone, string> = { blue: "#60a5fa", orange: "#fb923c", green: "#4ade80", amber: "#fbbf24", red: "#f87171", zinc: "#a1a1aa" };
const BRIGHT: Record<Tone, string> = { blue: "#93c5fd", orange: "#fdba74", green: "#86efac", amber: "#fcd34d", red: "#fca5a5", zinc: "#e4e4e7" };
const BAR: Record<Tone, string> = { blue: "bg-blue-500/60", orange: "bg-orange-500/55", green: "bg-emerald-500/55", amber: "bg-amber-500/60", red: "bg-red-500/60", zinc: "bg-zinc-600" };
const KPI_TXT: Record<Tone, string> = { blue: "text-blue-400", orange: "text-orange-400", green: "text-emerald-400", amber: "text-amber-400", red: "text-red-400", zinc: "text-zinc-100" };

const fmtNum = (n: number): string =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));

// Smooth (rounded) path — horizontal-tangent cubic between points.
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

// The line/area chart — gradient fill, rounded line, a hover dot + tooltip (our
// tooltip look). `strong` = the bolder area fill (the dashboard "area" kind).
function LineChart({ shape, strong }: { shape: Extract<Shape, { kind: "series" | "area" }>; strong: boolean }) {
  const tone = shape.tone ?? "zinc";
  const ink = INK[tone];
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
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
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };
  const hx = hover != null && n > 1 ? (hover / (n - 1)) * 100 : 0;
  const hyPct = hover != null ? (xy[hover][1] / H) * 100 : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={ref} className="relative min-h-0 w-full flex-1" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
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
            <div
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-950"
              style={{ left: `${hx}%`, top: `${hyPct}%`, background: BRIGHT[tone] }}
            />
            <div
              className="pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-200 shadow-xl"
              style={{ left: `${Math.min(88, Math.max(2, hx))}%`, top: `${Math.max(14, hyPct)}%`, transform: `translate(-50%, calc(-100% - 6px))` }}
            >
              <div className="text-zinc-400">{shape.labels?.[hover] ?? `#${hover + 1}`}</div>
              <div className="tabular-nums">{fmtNum(pts[hover])}</div>
            </div>
          </>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-zinc-600">
        <span>{shape.capL}</span>
        <span>{shape.capR}</span>
      </div>
    </div>
  );
}

function RankingBody({ shape }: { shape: Extract<Shape, { kind: "ranking" }> }) {
  if (!shape.rows.length) return <p className="text-[10px] text-zinc-600">—</p>;
  return (
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
      {shape.rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[64px_1fr_48px] items-center gap-2 text-[10px]">
          <span className="truncate text-zinc-300">{r.name}</span>
          <span className="h-2 overflow-hidden rounded bg-zinc-800">
            <i className={`block h-full rounded ${BAR[shape.tone ?? "zinc"]}`} style={{ width: `${r.pct}%` }} />
          </span>
          <span className="text-right text-zinc-500">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function DistBody({ shape }: { shape: Extract<Shape, { kind: "distribution" }> }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-end gap-1">
        {shape.bins.map((b, i) => (
          <span key={i} className={`flex-1 rounded-t ${b.hot ? "bg-amber-500/70" : BAR[shape.tone ?? "zinc"]}`} style={{ height: `${Math.max(3, b.h)}%` }} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-zinc-600">
        <span>{shape.xL}</span>
        <span>{shape.xR}</span>
      </div>
    </div>
  );
}

function ScatterBody({ shape }: { shape: Extract<Shape, { kind: "scatter" }> }) {
  const ink = INK[shape.tone ?? "zinc"];
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
            title={`${p.label ?? ""} · ${p.x} ${shape.xL} · ${fmtNum(p.y)} ${shape.yL}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-zinc-600">
        <span>{shape.xL} →</span>
        <span>↑ {shape.yL}</span>
      </div>
    </div>
  );
}

function HeatBody({ shape }: { shape: Extract<Shape, { kind: "heatmap" }> }) {
  const ink = INK[shape.tone ?? "zinc"];
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
              title={`${shape.rows[r]} ${c}:00 · ${v}`}
            />
          )),
        )}
      </div>
      <div className="flex justify-between text-[9px] text-zinc-600">
        <span>{shape.cols[0]}</span>
        <span>23h</span>
      </div>
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

// A hover dropdown for the PROJECT scope (mirrors the session picker's behavior).
function ProjectMenu({ projects, value, onPick }: { projects: string[]; value: string | null; onPick: (p: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 160);
  };
  return (
    <div className="relative flex shrink-0 items-center" onMouseEnter={enter} onMouseLeave={leave}>
      <span className={`cursor-pointer rounded px-1 py-0.5 text-xs transition-colors ${value ? "text-zinc-200 hover:text-white" : "text-zinc-300 hover:text-white"}`}>
        {value ?? "all projects"}
      </span>
      {open && (
        <div className="scrollbar-none absolute left-0 top-full z-50 mt-1 flex max-h-[340px] w-56 flex-col overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
          <button
            type="button"
            onClick={() => { onPick(null); setOpen(false); }}
            className={`rounded px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-zinc-900 ${value ? "text-zinc-300" : "text-green-400"}`}
          >
            All projects
          </button>
          {projects.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => { onPick(p); setOpen(false); }}
              className={`truncate rounded px-2 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-zinc-900 ${value === p ? "text-green-400" : "text-zinc-300"}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const STAT_KINDS = new Set(["stat"]);

export default function FleetView() {
  const { placed, setPlaced, addMetric, removeMetric, setCatalog, project, setProject, sessions, setSessions } = useKpis();
  const [metrics, setMetrics] = useState<FleetMetrics | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [wide, setWide] = useState(true);

  // metrics — re-fetch on scope or placed change, then ~8s
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
  const colWrap = wide ? "" : "mx-auto w-full max-w-5xl";

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
      {/* header — ● project picker · session picker (multi) · ⋮ panels · ⤢ */}
      <div className={`mb-1 ${colWrap}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 pb-3">
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="size-2 rounded-full bg-green-500/60" title="fleet dashboard — live data" />
          </span>
          <ProjectMenu projects={projects} value={project} onPick={setProject} />
          <span className="text-zinc-700">·</span>
          {/* hover → SessionMenu in MULTI-SELECT mode; pick several to compose a scope */}
          <SessionMenu currentId={sessions[0] ?? null} selected={sessions} onToggle={toggleSession} onClear={() => setSessions([])}>
            <span
              title="sessions — hover to select one or many"
              className={`cursor-pointer rounded px-1 py-0.5 text-[11px] transition-colors ${sessions.length ? "text-green-400 hover:text-green-300" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {sessionLabel}
            </span>
          </SessionMenu>
          {/* ⋮ panels nav — Metrics → KPIs opens the metric library */}
          <TerminalNavMenu project={project ?? ""} sessionId={sessions[0] ?? null} />
          <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => window.dispatchEvent(new Event("hq:fleet-grid-reset"))} title="reset the dashboard layout" className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
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
      </div>

      {/* body — the board (a drop target for metric cards dragged from kpi-panel) */}
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
            Empty board — open the <b className="font-medium text-zinc-300">⋮ → Metrics → KPIs</b> library and drag a card here.
          </p>
        ) : (
          <FleetGrid storageKey="hq-fleet-grid" items={gridItems} />
        )}
      </div>
    </div>
  );
}
