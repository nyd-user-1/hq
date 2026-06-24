"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

const COLS: Record<
  ColKey,
  { label: string; align?: "right"; type: "text" | "num" | "date"; w: number; min: number }
> = {
  name: { label: "Name", type: "text", w: 220, min: 140 },
  file: { label: "File", type: "text", w: 160, min: 96 },
  size: { label: "Size", align: "right", type: "num", w: 70, min: 52 },
  kind: { label: "Kind", type: "text", w: 84, min: 56 },
  modified: { label: "Modified", type: "date", w: 116, min: 88 },
  created: { label: "Created", type: "date", w: 116, min: 88 },
};
const DEFAULT_ORDER: ColKey[] = ["name", "file", "size", "kind", "modified", "created"];
const KEYS = Object.keys(COLS) as ColKey[];
const ORDER_KEY = "hq-cmdk-files-cols";
const WIDTH_KEY = "hq-cmdk-files-widths";
const HIDDEN_KEY = "hq-cmdk-files-hidden";
const GROUP_KEY = "hq-cmdk-files-group";

function load<T>(key: string, ok: (v: unknown) => v is T, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    if (ok(v)) return v;
  } catch {
    /* ignore */
  }
  return fallback;
}

// ALL view — a macOS-Finder-style table. Headers click-to-sort, drag-to-reorder,
// drag-the-edge to resize. Toolbar adds a column show/hide picker and Group By.
// Right-click a row for Open / Copy ref / Favorite.
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
  const [widths, setWidths] = useState<Record<ColKey, number>>(
    () => Object.fromEntries(KEYS.map((k) => [k, COLS[k].w])) as Record<ColKey, number>
  );
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set());
  const [groupBy, setGroupBy] = useState<"none" | "kind">("none");
  const [sort, setSort] = useState<{ key: ColKey; dir: SortDir }>({ key: "modified", dir: "desc" });
  const [drag, setDrag] = useState<ColKey | null>(null);
  const [menuOpen, setMenuOpen] = useState<"cols" | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: FileRow } | null>(null);
  const [localMeta, setLocalMeta] = useState<FilesMeta>(meta);
  const resizing = useRef(false);

  useEffect(() => {
    setOrder(load(ORDER_KEY, (v): v is ColKey[] => Array.isArray(v) && v.length === KEYS.length, DEFAULT_ORDER));
    setWidths((p) => ({ ...p, ...load(WIDTH_KEY, (v): v is Record<ColKey, number> => !!v && typeof v === "object", {} as Record<ColKey, number>) }));
    setHidden(new Set(load(HIDDEN_KEY, (v): v is ColKey[] => Array.isArray(v), [])));
    setGroupBy(load(GROUP_KEY, (v): v is "none" | "kind" => v === "none" || v === "kind", "none"));
  }, []);
  useEffect(() => setLocalMeta(meta), [meta]);

  // close popovers on any outside interaction
  useEffect(() => {
    const close = () => {
      setMenuOpen(null);
      setCtx(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  const visible = order.filter((k) => !hidden.has(k));
  const nameOf = (r: FileRow) => localMeta[`${r.kind}:${r.ref}`]?.title || r.name || r.ref;

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

  // group preserving sort order within each kind
  const groups = useMemo(() => {
    if (groupBy !== "kind") return [{ label: "", rows: sorted }];
    const m = new Map<string, FileRow[]>();
    for (const r of sorted) (m.get(r.kind) ?? m.set(r.kind, []).get(r.kind)!).push(r);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, rs]) => ({ label, rows: rs }));
  }, [sorted, groupBy]);

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
      next.has(k) ? next.delete(k) : next.add(k);
      persist(HIDDEN_KEY, [...next]);
      return next;
    });
  }
  function startResize(e: React.MouseEvent, key: ColKey) {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    const startX = e.clientX;
    const startW = widths[key];
    const move = (ev: MouseEvent) => setWidths((p) => ({ ...p, [key]: Math.max(COLS[key].min, startW + (ev.clientX - startX)) }));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setWidths((p) => { persist(WIDTH_KEY, p); return p; });
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
    setCtx(null);
  }
  function copyRef(r: FileRow) {
    const text = r.kind === "turn" ? `hq:turn ${r.ref}` : r.file || r.ref;
    navigator.clipboard.writeText(text);
    setCtx(null);
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

  const total = visible.reduce((s, k) => s + widths[k], 0);

  return (
    <div className="scrollbar-none -mr-2 flex min-h-0 min-w-0 flex-1 flex-col pr-2">
      {/* toolbar: column picker + group-by */}
      <div className="flex items-center gap-2 pb-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((m) => (m === "cols" ? null : "cols")); }}
            className="rounded px-1.5 py-0.5 hover:bg-zinc-900 hover:text-zinc-300"
          >
            ⊞ Columns
          </button>
          {menuOpen === "cols" && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-6 z-30 w-40 rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
            >
              {KEYS.map((k) => (
                <button
                  key={k}
                  onClick={() => toggleHidden(k)}
                  disabled={k === "name"}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left normal-case tracking-normal text-zinc-300 hover:bg-zinc-900 disabled:opacity-40"
                >
                  <span className="w-3">{!hidden.has(k) ? "✓" : ""}</span>
                  {COLS[k].label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); const v = groupBy === "kind" ? "none" : "kind"; setGroupBy(v); persist(GROUP_KEY, v); }}
          className="rounded px-1.5 py-0.5 hover:bg-zinc-900 hover:text-zinc-300"
        >
          Group: {groupBy === "kind" ? "Kind" : "None"}
        </button>
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-auto">
        <table className="table-fixed border-collapse font-mono text-[11px]" style={{ width: total }}>
          <colgroup>{visible.map((k) => <col key={k} style={{ width: widths[k] }} />)}</colgroup>
          <thead className="sticky top-0 z-10 bg-zinc-950">
            <tr className="text-zinc-500">
              {visible.map((k) => {
                const c = COLS[k];
                const active = sort.key === k;
                return (
                  <th
                    key={k}
                    draggable
                    onDragStart={(e) => { if (resizing.current) return e.preventDefault(); setDrag(k); }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOn(k)}
                    onClick={() => clickSort(k)}
                    title="Click to sort · drag to reorder · drag the edge to resize"
                    className={`relative cursor-pointer select-none px-2 py-1.5 font-normal uppercase tracking-wide hover:text-zinc-300 ${c.align === "right" ? "text-right" : "text-left"} ${active ? "text-zinc-300" : ""} ${drag === k ? "opacity-50" : ""}`}
                  >
                    <span className="truncate">{c.label}</span>
                    {active && <span className="ml-1 text-zinc-600">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                    <span
                      onMouseDown={(e) => startResize(e, k)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-zinc-700"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <FragmentRows
                key={g.label || "all"}
                label={g.label}
                rows={g.rows}
                visible={visible}
                renderCell={renderCell}
                onOpen={onOpen}
                onCtx={(e, row) => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, row }); }}
                colSpan={visible.length}
              />
            ))}
          </tbody>
        </table>
      </div>

      {ctx && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ left: ctx.x, top: ctx.y }}
          className="fixed z-[100] w-44 rounded-md border border-zinc-800 bg-zinc-950 p-1 font-mono text-[11px] shadow-2xl"
        >
          <button onClick={() => { onOpen(ctx.row); setCtx(null); }} className="block w-full rounded px-2 py-1 text-left text-zinc-300 hover:bg-zinc-900">Open</button>
          <button onClick={() => toggleFav(ctx.row)} className="block w-full rounded px-2 py-1 text-left text-zinc-300 hover:bg-zinc-900">
            {localMeta[`${ctx.row.kind}:${ctx.row.ref}`]?.favorite ? "Unfavorite" : "Favorite"}
          </button>
          <button onClick={() => copyRef(ctx.row)} className="block w-full rounded px-2 py-1 text-left text-zinc-300 hover:bg-zinc-900">
            {ctx.row.kind === "turn" ? "Copy hq:turn ref" : "Copy filename"}
          </button>
        </div>
      )}
    </div>
  );
}

function FragmentRows({
  label, rows, visible, renderCell, onOpen, onCtx, colSpan,
}: {
  label: string;
  rows: FileRow[];
  visible: ColKey[];
  renderCell: (r: FileRow, k: ColKey) => ReactNode;
  onOpen: (r: FileRow) => void;
  onCtx: (e: React.MouseEvent, r: FileRow) => void;
  colSpan: number;
}) {
  return (
    <>
      {label && (
        <tr>
          <td colSpan={colSpan} className="bg-zinc-950/80 px-2 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            {label} · {rows.length}
          </td>
        </tr>
      )}
      {rows.map((r) => (
        <tr
          key={`${r.kind}:${r.ref}`}
          onClick={() => onOpen(r)}
          onContextMenu={(e) => onCtx(e, r)}
          className="cursor-pointer border-t border-zinc-900 text-zinc-300 hover:bg-zinc-900"
        >
          {visible.map((k) => (
            <td key={k} className={`px-2 py-1.5 align-middle ${COLS[k].align === "right" ? "text-right" : ""}`}>
              {renderCell(r, k)}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
