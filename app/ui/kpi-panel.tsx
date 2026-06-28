"use client";

import { useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useKpis, RECOMMENDED_VIEWS } from "@/app/ui/kpi-state";
import type { MetricDef, MetricKind } from "@/lib/fleet";

// hq's KPI library — the metric catalog, on the skills-panel.tsx push-in STANDARD
// (a root-level slide-in via AppPanel). Each metric is a card tagged with its chart
// SHAPE and is DRAGGABLE onto the Fleet board (dataTransfer "application/hq-metric")
// or click-to-add. The registry only shows metrics USABLE in the current scope
// (session-only metrics hide unless exactly one session is selected). Card design
// kept from the original (interior-panel.tsx); state shared via kpi-state.

export const DRAG_TYPE = "application/hq-metric";

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
  if (kind === "distribution" || kind === "histogram")
    return (
      <svg {...common} fill="currentColor">
        <rect x="3" y="11" width="3.5" height="9" rx="1" />
        <rect x="8.5" y="6" width="3.5" height="14" rx="1" />
        <rect x="14" y="13" width="3.5" height="7" rx="1" />
        <rect x="19.5" y="9" width="3.5" height="11" rx="1" />
      </svg>
    );
  if (kind === "area")
    return (
      <svg {...common} fill="currentColor" opacity="0.9">
        <path d="M3 18l5-7 4 3 5-8 4 5v8H3z" />
      </svg>
    );
  if (kind === "scatter")
    return (
      <svg {...common} fill="currentColor">
        <circle cx="6" cy="16" r="1.6" /><circle cx="11" cy="9" r="1.6" /><circle cx="15" cy="14" r="1.6" /><circle cx="19" cy="6" r="1.6" /><circle cx="9" cy="18" r="1.6" />
      </svg>
    );
  if (kind === "heatmap")
    return (
      <svg {...common} fill="currentColor">
        {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={3 + c * 6.5} y={3 + r * 6.5} width="5.5" height="5.5" rx="1" opacity={0.3 + ((r + c) % 3) * 0.3} />))}
      </svg>
    );
  if (kind === "stacked")
    return (
      <svg {...common} fill="currentColor">
        <rect x="3" y="13" width="18" height="3.5" rx="1" opacity="0.5" />
        <rect x="3" y="8.5" width="18" height="3.5" rx="1" opacity="0.8" />
      </svg>
    );
  if (kind === "table")
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" />
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

export default function KpiPanel() {
  const { open, setOpen, catalog, setCatalog, placed, setPlaced, addMetric, removeMetric, sessions, views } = useKpis();
  const viewList = [...views, ...RECOMMENDED_VIEWS.filter((r) => !views.some((v) => v.name === r.name))];
  const [q, setQ] = useState("");
  const placedSet = useMemo(() => new Set(placed ?? []), [placed]);

  // self-sufficient: if opened before the board has fetched, pull the catalog.
  useEffect(() => {
    if (!open || catalog.length) return;
    let live = true;
    fetch("/api/fleet/metrics", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && Array.isArray(d?.catalog) && setCatalog(d.catalog))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, catalog.length, setCatalog]);

  // Registry shows only metrics USABLE in the current scope: with a single session
  // selected everything applies (session metrics + global fleet ones); otherwise
  // (all / a project / multi-session) the session-only metrics are hidden.
  const single = sessions.length === 1;
  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const hit = catalog.filter(
      (d) =>
        (single || d.scopes.includes("fleet")) &&
        (!query || `${d.label} ${d.group} ${d.kind}`.toLowerCase().includes(query)),
    );
    const map = new Map<string, MetricDef[]>();
    for (const d of hit) {
      const arr = map.get(d.group) ?? [];
      arr.push(d);
      map.set(d.group, arr);
    }
    return [...map.entries()];
  }, [catalog, q, single]);

  return (
    <AppPanel rootId="kpi-panel-root" open={open} onClose={() => setOpen(false)} widthClass="sm:w-[min(360px,40vw)]">
      <Boundary label="kpi-panel.tsx">
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={catalog.length ? `Search ${catalog.length} metrics…` : "Search metrics…"}
            className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
        </div>
        <p className="shrink-0 text-[10px] text-zinc-600">
          {single ? "session scope" : sessions.length ? `${sessions.length} sessions` : "all / project scope"} — drag a card onto the board, or click to add.
        </p>
        <div className="scrollbar-none -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {viewList.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 px-0.5 text-[9px] uppercase tracking-widest text-zinc-600">Views</div>
              <div className="flex flex-col gap-1.5">
                {viewList.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => setPlaced(v.ids)}
                    title="load this view onto the board"
                    className="flex items-center gap-2 rounded-md border border-zinc-800/70 px-2.5 py-2 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-900/60"
                  >
                    <span className="shrink-0 text-zinc-500">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-200">{v.name}</span>
                    <span className="shrink-0 text-[9px] uppercase tracking-wide text-zinc-600">{v.ids.length} cards</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {groups.length === 0 ? (
            <p className="px-1 py-3 text-[10px] text-zinc-600">no metrics</p>
          ) : (
            groups.map(([group, defs]) => (
              <div key={group} className="mb-3">
                <div className="mb-1.5 px-0.5 text-[9px] uppercase tracking-widest text-zinc-600">{group}</div>
                <div className="flex flex-col gap-1.5">
                  {defs.map((d) => (
                    <MetricCard key={d.id} def={d} on={placedSet.has(d.id)} onAdd={addMetric} onRemove={removeMetric} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </Boundary>
    </AppPanel>
  );
}
