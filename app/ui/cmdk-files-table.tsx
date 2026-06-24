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
const ORDER_KEY = "hq-cmdk-files-cols";
const WIDTH_KEY = "hq-cmdk-files-widths";
const KEYS = Object.keys(COLS) as ColKey[];

function loadOrder(): ColKey[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) || "null");
    if (Array.isArray(raw) && raw.length === DEFAULT_ORDER.length && raw.every((k) => k in COLS))
      return raw as ColKey[];
  } catch {
    /* ignore */
  }
  return DEFAULT_ORDER;
}
function loadWidths(): Record<ColKey, number> {
  const base = Object.fromEntries(KEYS.map((k) => [k, COLS[k].w])) as Record<ColKey, number>;
  try {
    const raw = JSON.parse(localStorage.getItem(WIDTH_KEY) || "null");
    if (raw && typeof raw === "object")
      for (const k of KEYS) if (typeof raw[k] === "number") base[k] = raw[k];
  } catch {
    /* ignore */
  }
  return base;
}

// ALL view — a macOS-Finder-style column table. Headers click-to-sort,
// drag-to-reorder, and drag the right edge to resize (px widths, min-width floor,
// horizontal scroll when wider than the box). Name overlays the favorite ★ + rename.
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
  const [sort, setSort] = useState<{ key: ColKey; dir: SortDir }>({ key: "modified", dir: "desc" });
  const [drag, setDrag] = useState<ColKey | null>(null);
  const resizing = useRef(false);

  useEffect(() => {
    setOrder(loadOrder());
    setWidths(loadWidths());
  }, []);

  const nameOf = (r: FileRow) => meta[`${r.kind}:${r.ref}`]?.title || r.name || r.ref;

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
  }, [rows, sort, meta]);

  function clickSort(key: ColKey) {
    if (resizing.current) return;
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: COLS[key].type === "text" ? "asc" : "desc" }
    );
  }

  function dropOn(target: ColKey) {
    if (!drag || drag === target) return setDrag(null);
    const next = order.filter((k) => k !== drag);
    next.splice(next.indexOf(target), 0, drag);
    setOrder(next);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setDrag(null);
  }

  function startResize(e: React.MouseEvent, key: ColKey) {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    const startX = e.clientX;
    const startW = widths[key];
    const move = (ev: MouseEvent) => {
      const w = Math.max(COLS[key].min, startW + (ev.clientX - startX));
      setWidths((p) => ({ ...p, [key]: w }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setWidths((p) => {
        try { localStorage.setItem(WIDTH_KEY, JSON.stringify(p)); } catch { /* ignore */ }
        return p;
      });
      setTimeout(() => (resizing.current = false), 0); // let the click handler see it
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function renderCell(r: FileRow, key: ColKey) {
    if (key === "name") {
      const m = meta[`${r.kind}:${r.ref}`];
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          {m?.favorite && <span className="shrink-0 text-amber-400">★</span>}
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

  const total = order.reduce((s, k) => s + widths[k], 0);

  return (
    <div className="scrollbar-none -mr-2 min-h-0 min-w-0 flex-1 overflow-auto pr-2">
      <table
        className="table-fixed border-collapse font-mono text-[11px]"
        style={{ width: total }}
      >
        <colgroup>
          {order.map((k) => (
            <col key={k} style={{ width: widths[k] }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-zinc-950">
          <tr className="text-zinc-500">
            {order.map((k) => {
              const c = COLS[k];
              const active = sort.key === k;
              return (
                <th
                  key={k}
                  draggable
                  onDragStart={(e) => {
                    if (resizing.current) return e.preventDefault();
                    setDrag(k);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropOn(k)}
                  onClick={() => clickSort(k)}
                  title="Click to sort · drag to reorder · drag the edge to resize"
                  className={`relative cursor-pointer select-none px-2 py-1.5 font-normal uppercase tracking-wide hover:text-zinc-300 ${
                    c.align === "right" ? "text-right" : "text-left"
                  } ${active ? "text-zinc-300" : ""} ${drag === k ? "opacity-50" : ""}`}
                >
                  <span className="truncate">{c.label}</span>
                  {active && (
                    <span className="ml-1 text-zinc-600">{sort.dir === "asc" ? "▲" : "▼"}</span>
                  )}
                  {/* resize handle on the right edge */}
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
          {sorted.map((r) => (
            <tr
              key={`${r.kind}:${r.ref}`}
              onClick={() => onOpen(r)}
              className="cursor-pointer border-t border-zinc-900 text-zinc-300 hover:bg-zinc-900"
            >
              {order.map((k) => (
                <td
                  key={k}
                  className={`px-2 py-1.5 align-middle ${COLS[k].align === "right" ? "text-right" : ""}`}
                >
                  {renderCell(r, k)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
