"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FileRow } from "@/lib/files-index";

export type FilesMeta = Record<string, { favorite?: boolean; title?: string }>;

function fmtSize(n: number): string {
  if (n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDate(ms: number): string {
  if (!ms || ms < 0) return "—";
  const d = new Date(ms);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

type ColKey = "name" | "file" | "size" | "kind" | "modified" | "created";
type SortDir = "asc" | "desc";

const COLS: Record<ColKey, { label: string; align?: "right"; type: "text" | "num" | "date" }> = {
  name: { label: "Name", type: "text" },
  file: { label: "File", type: "text" },
  size: { label: "Size", align: "right", type: "num" },
  kind: { label: "Kind", type: "text" },
  modified: { label: "Modified", type: "date" },
  created: { label: "Created", type: "date" },
};
const DEFAULT_ORDER: ColKey[] = ["name", "file", "size", "kind", "modified", "created"];
const KEYS = Object.keys(COLS) as ColKey[];
const ORDER_KEY = "hq-cmdk-files-cols";
const FRAC_KEY = "hq-cmdk-files-fracs"; // per-column width WEIGHTS (container-independent)
const HIDDEN_KEY = "hq-cmdk-files-hidden";

const ACTION_W = 60; // fixed width of the trailing Action (⋯) column, px
const MIN_PAIR_FRAC = 0.16; // on resize, each of the two adjacent columns keeps ≥16% of their shared width

function load<T>(key: string, ok: (v: unknown) => v is T, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    if (ok(v)) return v;
  } catch {
    /* ignore */
  }
  return fallback;
}

// The FILES view — a macOS-Finder-style table. Columns DISTRIBUTE EVENLY to fill
// the width by default (no horizontal scroll, ever); drag the visible divider
// between two headers to resize (it steals width from its right neighbor, so the
// total never changes). Click a header to sort, drag it to reorder, RIGHT-CLICK
// it for the column show/hide picker (Finder-style — no toolbar). A trailing
// Action column carries a ⋯ menu (Open / Favorite / Copy filename), same as a
// right-click on the row.
export default function CmdkFilesTable({
  rows,
  meta,
  onOpen,
}: {
  rows: FileRow[];
  meta: FilesMeta;
  onOpen: (row: FileRow) => void;
}) {
  const [order, setOrder] = useState<ColKey[]>(DEFAULT_ORDER);
  // width WEIGHTS per column (not px) — render divides them across the available
  // width, so they're independent of the palette's size. Even by default (all 1).
  const [fracs, setFracs] = useState<Record<ColKey, number>>(
    () => Object.fromEntries(KEYS.map((k) => [k, 1])) as Record<ColKey, number>
  );
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set());
  const [sort, setSort] = useState<{ key: ColKey; dir: SortDir }>({ key: "modified", dir: "desc" });
  const [drag, setDrag] = useState<ColKey | null>(null);
  // ONE popover: the column picker (header right-click) OR the row action menu.
  const [menu, setMenu] = useState<
    { x: number; y: number; kind: "cols" } | { x: number; y: number; kind: "row"; row: FileRow } | null
  >(null);
  const [localMeta, setLocalMeta] = useState<FilesMeta>(meta);
  const [containerW, setContainerW] = useState(660); // measured; sensible default avoids a first-paint collapse
  const resizing = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrder(load(ORDER_KEY, (v): v is ColKey[] => Array.isArray(v) && v.length === KEYS.length, DEFAULT_ORDER));
    setHidden(new Set(load(HIDDEN_KEY, (v): v is ColKey[] => Array.isArray(v), [])));
    setFracs((p) => ({ ...p, ...load(FRAC_KEY, (v): v is Record<ColKey, number> => !!v && typeof v === "object", {} as Record<ColKey, number>) }));
  }, []);
  useEffect(() => setLocalMeta(meta), [meta]);

  // Track the available width so even-distribution + resize math work in px.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setContainerW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // close the popover on any outside interaction
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  const visible = order.filter((k) => !hidden.has(k));
  const nameOf = (r: FileRow) => localMeta[`${r.kind}:${r.ref}`]?.title || r.name || r.ref;

  // Even by default: each visible column gets its weight's share of the width
  // left after the fixed Action column. Always sums to dataW → no horizontal scroll.
  const dataW = Math.max(0, containerW - ACTION_W);
  const sumFrac = visible.reduce((s, k) => s + (fracs[k] || 1), 0) || 1;
  const colPx = (k: ColKey) => ((fracs[k] || 1) / sumFrac) * dataW;

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (r: FileRow): string | number => {
      switch (sort.key) {
        case "name": return nameOf(r).toLowerCase();
        case "file": return r.file.toLowerCase();
        case "kind": return r.kind;
        case "size": return r.size;
        case "modified": return r.modified;
        case "created": return r.created;
      }
    };
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, localMeta]);

  function persist(key: string, v: unknown) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  }
  function clickSort(key: ColKey) {
    if (resizing.current) return;
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: COLS[key].type === "text" ? "asc" : "desc" }));
  }
  function dropOn(target: ColKey) {
    if (!drag || drag === target) return setDrag(null);
    const next = order.filter((k) => k !== drag);
    next.splice(next.indexOf(target), 0, drag);
    setOrder(next);
    persist(ORDER_KEY, next);
    setDrag(null);
  }
  function toggleHidden(k: ColKey) {
    if (k === "name") return; // Name always visible
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      persist(HIDDEN_KEY, [...next]);
      return next;
    });
  }
  // Resize the boundary between column `k` and its right neighbor: shift weight
  // from one to the other so their COMBINED width is unchanged — the rest of the
  // table never moves and nothing overflows.
  function startResize(e: React.MouseEvent, k: ColKey) {
    const i = visible.indexOf(k);
    const nk = visible[i + 1];
    if (!nk) return; // the last data column has no neighbor to trade with
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    const startX = e.clientX;
    const a0 = fracs[k] || 1;
    const b0 = fracs[nk] || 1;
    const pair = a0 + b0;
    const pairPx = (pair / sumFrac) * dataW || 1;
    const minF = MIN_PAIR_FRAC * pair;
    const move = (ev: MouseEvent) => {
      const d = ((ev.clientX - startX) / pairPx) * pair;
      let a = a0 + d, b = b0 - d;
      if (a < minF) { b -= minF - a; a = minF; }
      if (b < minF) { a -= minF - b; b = minF; }
      setFracs((p) => ({ ...p, [k]: a, [nk]: b }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setFracs((p) => { persist(FRAC_KEY, p); return p; });
      setTimeout(() => (resizing.current = false), 0);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  function toggleFav(r: FileRow) {
    const key = `${r.kind}:${r.ref}`;
    const next = !localMeta[key]?.favorite;
    setLocalMeta((p) => ({ ...p, [key]: { ...p[key], favorite: next } }));
    fetch("/api/file-meta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: r.kind, ref: r.ref, favorite: next }),
    }).catch(() => {});
    setMenu(null);
  }
  function copyRef(r: FileRow) {
    const text = r.kind === "turn" ? `hq:turn ${r.ref}` : r.file || r.ref;
    navigator.clipboard.writeText(text);
    setMenu(null);
  }

  function renderCell(r: FileRow, key: ColKey) {
    if (key === "name") {
      const fav = localMeta[`${r.kind}:${r.ref}`]?.favorite;
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          {fav && <span className="shrink-0 text-amber-400">★</span>}
          <span className="truncate">{nameOf(r)}</span>
        </div>
      );
    }
    if (key === "file") return <div className="truncate text-zinc-600">{r.file}</div>;
    if (key === "size") return <div className="text-zinc-500">{fmtSize(r.size)}</div>;
    if (key === "kind") return <div className="truncate uppercase text-zinc-500">{r.kind}</div>;
    return <div className="truncate text-zinc-500">{fmtDate(key === "modified" ? r.modified : r.created)}</div>;
  }

  if (rows.length === 0)
    return <p className="px-2 py-10 text-center font-mono text-[12px] text-zinc-600">No files</p>;

  return (
    <div
      ref={wrapRef}
      className="scrollbar-none -mr-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden pr-2"
    >
      <div className="scrollbar-none min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <table className="w-full table-fixed border-collapse font-mono text-[11px]">
          <colgroup>
            {visible.map((k) => <col key={k} style={{ width: colPx(k) }} />)}
            <col style={{ width: ACTION_W }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-zinc-950">
            <tr className="text-zinc-500">
              {visible.map((k, i) => {
                const c = COLS[k];
                const active = sort.key === k;
                const last = i === visible.length - 1;
                return (
                  <th
                    key={k}
                    draggable
                    onDragStart={(e) => { if (resizing.current) return e.preventDefault(); setDrag(k); }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOn(k)}
                    onClick={() => clickSort(k)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, kind: "cols" }); }}
                    title="Click to sort · drag to reorder · drag the divider to resize · right-click for columns"
                    className={`relative cursor-pointer select-none px-2 py-1.5 font-normal uppercase tracking-wide hover:text-zinc-300 ${c.align === "right" ? "text-right" : "text-left"} ${active ? "text-zinc-300" : ""} ${drag === k ? "opacity-50" : ""}`}
                  >
                    <span className="truncate">{c.label}</span>
                    {active && <span className="ml-1 text-zinc-600">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                    {/* visible, draggable divider between this column and the next
                        — the resize affordance. Sits ON the boundary (centered). */}
                    {!last && (
                      <span
                        onMouseDown={(e) => startResize(e, k)}
                        onClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => e.stopPropagation()}
                        className="group/grip absolute right-0 top-0 z-20 flex h-full w-2 translate-x-1/2 cursor-col-resize justify-center"
                      >
                        <span className="h-full w-px bg-zinc-800 transition-colors group-hover/grip:w-0.5 group-hover/grip:bg-zinc-500" />
                      </span>
                    )}
                  </th>
                );
              })}
              {/* Action column header */}
              <th className="select-none border-l border-zinc-900 px-2 py-1.5 text-right font-normal uppercase tracking-wide text-zinc-600">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={`${r.kind}:${r.ref}`}
                onClick={() => onOpen(r)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, kind: "row", row: r }); }}
                className="group/row cursor-pointer border-t border-zinc-900 text-zinc-300 hover:bg-zinc-900"
              >
                {visible.map((k) => (
                  <td key={k} className={`px-2 py-1.5 align-middle ${COLS[k].align === "right" ? "text-right" : ""}`}>
                    {renderCell(r, k)}
                  </td>
                ))}
                {/* ⋯ action — opens the same menu as a right-click on the row */}
                <td className="border-l border-zinc-900 px-1 py-1.5 text-right align-middle">
                  <button
                    aria-label="Row actions"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenu({ x: Math.max(8, rect.right - 176), y: rect.bottom + 4, kind: "row", row: r });
                    }}
                    className="rounded px-1.5 py-0.5 leading-none text-zinc-600 opacity-0 transition-opacity hover:bg-zinc-800 hover:text-zinc-200 group-hover/row:opacity-100"
                  >
                    ⋯
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* column show/hide picker — Finder-style, on a header right-click */}
      {menu?.kind === "cols" && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-[100] w-44 rounded-md border border-zinc-800 bg-zinc-950 p-1 font-mono text-[11px] shadow-2xl"
        >
          <div className="px-2 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-zinc-600">Columns</div>
          {KEYS.map((k) => (
            <button
              key={k}
              onClick={() => toggleHidden(k)}
              disabled={k === "name"}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
            >
              <span className="w-3">{!hidden.has(k) ? "✓" : ""}</span>
              {COLS[k].label}
            </button>
          ))}
        </div>
      )}

      {/* row actions — same set as the session table's ⋯, file-appropriate */}
      {menu?.kind === "row" && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-[100] w-44 rounded-md border border-zinc-800 bg-zinc-950 p-1 font-mono text-[11px] shadow-2xl"
        >
          <button onClick={() => { onOpen(menu.row); setMenu(null); }} className="block w-full rounded px-2 py-1 text-left text-zinc-300 hover:bg-zinc-900">Open</button>
          <button onClick={() => toggleFav(menu.row)} className="block w-full rounded px-2 py-1 text-left text-zinc-300 hover:bg-zinc-900">
            {localMeta[`${menu.row.kind}:${menu.row.ref}`]?.favorite ? "Unfavorite" : "Favorite"}
          </button>
          <button onClick={() => copyRef(menu.row)} className="block w-full rounded px-2 py-1 text-left text-zinc-300 hover:bg-zinc-900">
            {menu.row.kind === "turn" ? "Copy hq:turn ref" : "Copy filename"}
          </button>
        </div>
      )}
    </div>
  );
}
