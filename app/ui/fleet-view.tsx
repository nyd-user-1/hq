"use client";

import { useEffect, useState } from "react";
import type { FleetMetrics, Shape, Stat, Tone } from "@/lib/fleet";
import FleetGrid from "@/app/ui/fleet-grid";
import SessionMenu from "@/app/ui/session-menu";

// THE FLEET — hq's command deck, ported onto the terminal.tsx shell. Same stack
// as a terminal: a HEADER row (● project · session-id · ⤢) over a BODY — except
// the body is the dashboard GRID, not a chat stream + send-box. Hover the session
// id → SessionMenu (the exact terminal picker); pick one to SCOPE the board to
// that session, "All" to go fleet-wide (the default). The grid is the draggable
// canvas (FleetGrid): a KPI band + chart SHAPES (series / ranking / distribution)
// that re-scope on selection. The strip-board roster is gone — the picker owns
// scoping now. Canvas polls /api/fleet/metrics (~8s, re-fetched on scope change).

// ── shape renderers — the fixed chart vocabulary, SEMANTIC ink (matches hq's
// data panels): green=healthy · amber=premium · red=critical · orange=burn ·
// blue=usage · zinc=neutral. The tone rides on the data (lib/fleet decides what
// each number MEANS); the renderer just paints it.
const INK: Record<Tone, string> = {
  blue: "#60a5fa", orange: "#fb923c", green: "#4ade80", amber: "#fbbf24", red: "#f87171", zinc: "#a1a1aa",
};
const BAR: Record<Tone, string> = {
  blue: "bg-blue-500/60", orange: "bg-orange-500/55", green: "bg-emerald-500/55",
  amber: "bg-amber-500/60", red: "bg-red-500/60", zinc: "bg-zinc-600",
};
const KPI_TXT: Record<Tone, string> = {
  blue: "text-blue-400", orange: "text-orange-400", green: "text-emerald-400",
  amber: "text-amber-400", red: "text-red-400", zinc: "text-zinc-100",
};

function areaPath(points: number[], w = 300, h = 70): { line: string; area: string } {
  if (points.length < 2) return { line: "", area: "" };
  const max = Math.max(1, ...points);
  const step = w / (points.length - 1);
  const xy = points.map((p, i) => [i * step, h - (p / max) * (h - 6) - 3] as const);
  const line = "M" + xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  return { line, area: `${line} L${w},${h} L0,${h} Z` };
}

function SeriesBody({ shape }: { shape: Extract<Shape, { kind: "series" }> }) {
  const { line, area } = areaPath(shape.points);
  const ink = INK[shape.tone ?? "zinc"];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <svg viewBox="0 0 300 70" preserveAspectRatio="none" className="min-h-0 w-full flex-1" aria-hidden>
        <path d={area} fill={ink} fillOpacity="0.1" />
        <path d={line} fill="none" stroke={ink} strokeWidth="1.5" />
      </svg>
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
          <span
            key={i}
            className={`flex-1 rounded-t ${b.hot ? "bg-amber-500/70" : BAR[shape.tone ?? "zinc"]}`}
            style={{ height: `${Math.max(3, b.h)}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-zinc-600">
        <span>{shape.xL}</span>
        <span>{shape.xR}</span>
      </div>
    </div>
  );
}

function ShapeCard({ shape }: { shape: Shape }) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-3">
      <div className="mb-2.5 flex items-baseline gap-2">
        <span className="truncate text-[11px] text-zinc-400">{shape.title}</span>
        <span className="ml-auto rounded border border-zinc-800 px-1.5 text-[8px] uppercase tracking-widest text-zinc-600 transition group-hover/w:opacity-0">
          {shape.kind}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {shape.kind === "series" && <SeriesBody shape={shape} />}
        {shape.kind === "ranking" && <RankingBody shape={shape} />}
        {shape.kind === "distribution" && <DistBody shape={shape} />}
      </div>
    </div>
  );
}

// A KPI scalar tile — its own grid block.
function KpiTile({ k }: { k: Stat }) {
  return (
    <div className="flex h-full flex-col justify-center overflow-hidden rounded-lg border border-zinc-800/70 bg-zinc-900/30 px-2.5 py-2">
      <div className="truncate text-[8px] uppercase tracking-widest text-zinc-600">{k.label}</div>
      <div className={`mt-1 text-[19px] leading-none tracking-tight ${KPI_TXT[k.tone ?? "zinc"]}`}>{k.value}</div>
      {k.sub && <div className="mt-1 truncate text-[9px] text-zinc-600">{k.sub}</div>}
    </div>
  );
}

export default function FleetView() {
  const [metrics, setMetrics] = useState<FleetMetrics | null>(null);
  const [scopeId, setScopeId] = useState<string | null>(null); // null = fleet/all grain
  const [wide, setWide] = useState(true); // ⤢ widescreen ⇆ focus width (acts on the grid)

  // canvas metrics — re-fetch on scope change, then ~8s
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const q = scopeId ? `?session=${encodeURIComponent(scopeId)}` : "";
    const load = async () => {
      try {
        const d = await fetch(`/api/fleet/metrics${q}`, { cache: "no-store" }).then((r) => r.json());
        if (alive) setMetrics(d);
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
  }, [scopeId]);

  const scoped = metrics?.scope.level === "session";
  const project = scoped ? metrics!.scope.label.split(" · ")[0] : "all sessions";
  const idShort = scopeId ? scopeId.slice(0, 8) : null;
  const colWrap = wide ? "" : "mx-auto w-full max-w-5xl";

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-3 font-mono">
      {/* header — the terminal.tsx shell: ● project · session-id (hover → picker) · ⤢ */}
      <div className={`mb-1 ${colWrap}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 pb-3">
          <span className="flex items-center gap-1.5 text-xs">
            <span className="size-2 rounded-full bg-green-500/60" title="fleet dashboard — live data" />
            <span className="text-zinc-300">{project}</span>
          </span>
          {/* hover the id → SessionMenu; onPick SCOPES the board (not the terminal). */}
          <SessionMenu currentId={scopeId} onPick={setScopeId}>
            <span
              title={scopeId ? `dashboard scoped to ${idShort}` : "all sessions — hover to scope to one"}
              className={`cursor-pointer rounded px-1 py-0.5 text-[11px] transition-colors ${
                scopeId ? "text-green-400 hover:text-green-300" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {idShort ?? "all"}
            </span>
          </SessionMenu>
          {scopeId && (
            <button
              type="button"
              onClick={() => setScopeId(null)}
              title="back to all sessions"
              className="rounded-md px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              ← all
            </button>
          )}
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("hq:fleet-grid-reset"))}
              title="reset the dashboard layout"
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              {/* lucide rotate-ccw */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setWide((v) => !v)}
              title={wide ? "focus width" : "widescreen"}
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              {/* lucide maximize ⤢ */}
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

      {/* body — the dashboard grid, where the chat stream + send-box used to be */}
      <div className={`scrollbar-none min-h-0 flex-1 overflow-y-auto ${colWrap}`}>
        {!metrics ? (
          <p className="text-[10px] text-zinc-600">loading metrics…</p>
        ) : (
          <FleetGrid
            storageKey="hq-fleet-grid"
            items={[
              ...metrics.kpis.map((k, i) => ({ id: `kpi${i}`, w: 2, h: 3, minW: 1, node: <KpiTile k={k} /> })),
              ...metrics.shapes.map((s, i) => ({ id: `shape${i}`, w: 6, h: 8, minW: 2, node: <ShapeCard shape={s} /> })),
            ]}
          />
        )}
      </div>
    </div>
  );
}
