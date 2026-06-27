"use client";

import { useMemo, useState } from "react";
import type { MetricDef, MetricKind } from "@/lib/fleet";

// THE KPI LIBRARY — a browsable catalog of every metric, modelled on plugins-panel
// (search + grouped cards). Each card is tagged with its chart SHAPE and is both
// DRAGGABLE onto the Fleet board and click-to-add. Dragging sets the metric id on
// the dataTransfer ("application/hq-metric"); the board's drop handler places it.
// A metric already on the board reads "on board" and the card flips to remove.

const DRAG_TYPE = "application/hq-metric";

// A tiny glyph per shape so the card reads at a glance (matches the chart kinds).
function ShapeGlyph({ kind }: { kind: MetricKind }) {
  const common = { width: 13, height: 13, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (kind === "series")
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 15l5-6 4 4 6-8" />
      </svg>
    );
  if (kind === "ranking")
    return (
      <svg {...common} fill="currentColor">
        <rect x="3" y="4" width="18" height="3" rx="1.5" />
        <rect x="3" y="10.5" width="12" height="3" rx="1.5" />
        <rect x="3" y="17" width="7" height="3" rx="1.5" />
      </svg>
    );
  if (kind === "distribution")
    return (
      <svg {...common} fill="currentColor">
        <rect x="3" y="11" width="3.5" height="9" rx="1" />
        <rect x="8.5" y="6" width="3.5" height="14" rx="1" />
        <rect x="14" y="13" width="3.5" height="7" rx="1" />
        <rect x="19.5" y="9" width="3.5" height="11" rx="1" />
      </svg>
    );
  // stat
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h2v12" />
      <path d="M14 6h2a2 2 0 0 1 0 4h-2a2 2 0 0 0 0 4h2" />
    </svg>
  );
}

function MetricCard({
  def,
  on,
  onAdd,
  onRemove,
}: {
  def: MetricDef;
  on: boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, def.id);
        e.dataTransfer.setData("text/plain", def.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => (on ? onRemove(def.id) : onAdd(def.id))}
      title={on ? "on board — click to remove" : "click or drag onto the board"}
      className={`group flex cursor-grab select-none items-center gap-2 rounded-md border px-2.5 py-2 transition-colors ${
        on
          ? "border-emerald-600/40 bg-emerald-500/5 hover:border-red-600/40 hover:bg-red-500/5"
          : "border-zinc-800/70 hover:border-zinc-600 hover:bg-zinc-900/60"
      }`}
    >
      <span className={`shrink-0 ${on ? "text-emerald-400" : "text-zinc-500"}`}>
        <ShapeGlyph kind={def.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-zinc-200">{def.label}</span>
        <span className="block truncate text-[9px] uppercase tracking-widest text-zinc-600">{def.kind}</span>
      </span>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
          on ? "text-emerald-400 group-hover:hidden" : "text-zinc-600 group-hover:text-zinc-300"
        }`}
      >
        {on ? "on board" : "+ add"}
      </span>
      {on && <span className="hidden shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-red-400 group-hover:inline">remove</span>}
    </div>
  );
}

export default function KpiPanel({
  catalog,
  placed,
  onAdd,
  onRemove,
  onClose,
}: {
  catalog: MetricDef[];
  placed: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const placedSet = useMemo(() => new Set(placed), [placed]);

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const hit = catalog.filter((d) => !query || `${d.label} ${d.group} ${d.kind}`.toLowerCase().includes(query));
    const map = new Map<string, MetricDef[]>();
    for (const d of hit) {
      const arr = map.get(d.group) ?? [];
      arr.push(d);
      map.set(d.group, arr);
    }
    return [...map.entries()];
  }, [catalog, q]);

  return (
    <div className="flex w-64 shrink-0 flex-col rounded-lg border border-zinc-800 bg-zinc-950/60">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-2.5 py-2">
        <span className="text-[11px] uppercase tracking-widest text-zinc-300">Metrics</span>
        <button
          type="button"
          onClick={onClose}
          title="close library"
          className="ml-auto rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="shrink-0 px-2.5 py-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search metrics…"
          className="w-full rounded-md bg-zinc-900 px-2.5 py-1.5 font-mono text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600"
        />
      </div>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {groups.length === 0 ? (
          <p className="px-1 py-3 text-[10px] text-zinc-600">no matches</p>
        ) : (
          groups.map(([group, defs]) => (
            <div key={group} className="mb-3">
              <div className="mb-1.5 px-0.5 text-[9px] uppercase tracking-widest text-zinc-600">{group}</div>
              <div className="flex flex-col gap-1.5">
                {defs.map((d) => (
                  <MetricCard key={d.id} def={d} on={placedSet.has(d.id)} onAdd={onAdd} onRemove={onRemove} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="shrink-0 border-t border-zinc-800 px-2.5 py-1.5 text-[9px] text-zinc-600">
        drag a card onto the board, or click to add
      </div>
    </div>
  );
}

export { DRAG_TYPE };
