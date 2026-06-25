"use client";

import { useEffect, useMemo, useState } from "react";
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

// width: null = FLEX (shares the leftover space — the title/path columns); a number
// = a fixed px width sized to its content (the metadata columns), so dates and
// sizes never sprawl and the Name column absorbs the slack. No resizing — fixed,
// sensible proportions that just read as a table.
const COLS: Record<ColKey, { label: string; align?: "right"; type: "text" | "num" | "date"; width: number | null }> = {
  name: { label: "Name", type: "text", width: null },
  file: { label: "File", type: "text", width: null },
  size: { label: "Size", align: "right", type: "num", width: 78 },
  kind: { label: "Kind", type: "text", width: 92 },
  modified: { label: "Modified", type: "date", width: 138 },
  created: { label: "Created", type: "date", width: 138 },
};
const COL_ORDER: ColKey[] = ["name", "file", "size", "kind", "modified", "created"];
const KEYS = COL_ORDER;
const ACTION_W = 56;
const HIDDEN_KEY = "hq-cmdk-files-hidden";
// `file` is hidden by default — its path largely duplicates Name, and dropping it
// gives Name room to breathe. Toggle any column from the header right-click menu.
const DEFAULT_HIDDEN: ColKey[] = ["file"];

function load<T>(key: string, ok: (v: unknown) => v is T, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    if (ok(v)) return v;
  } catch {
    /* ignore */
  }
  return fallback;
}

// The FILES view — a clean, fixed-layout Finder table. Metadata columns are sized
// to their content; Name (and File, when shown) flex to fill the rest, so there's
// no wasted space and no horizontal scroll. Click a header to sort; RIGHT-CLICK a
// header for the column show/hide picker (macOS Finder style — no toolbar). Each
// row carries a ⋯ Action menu (Open / Favorite / Copy filename), same as a
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
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set(DEFAULT_HIDDEN));
  const [sort, setSort] = useState<{ key: ColKey; dir: SortDir }>({ key: "modified", dir: "desc" });
  // ONE popover: the column picker (header right-click) OR the row action menu.
  const [menu, setMenu] = useState<
    { x: number; y: number; kind: "cols" } | { x: number; y: number; kind: "row"; row: FileRow } | null
  >(null);
  const [localMeta, setLocalMeta] = useState<FilesMeta>(meta);

  useEffect(() => {
    setHidden(new Set(load(HIDDEN_KEY, (v): v is ColKey[] => Array.isArray(v), DEFAULT_HIDDEN)));
  }, []);
  useEffect(() => setLocalMeta(meta), [meta]);

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

  const visible = COL_ORDER.filter((k) => !hidden.has(k));
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

  function clickSort(key: ColKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: COLS[key].type === "text" ? "asc" : "desc" }));
  }
  function toggleHidden(k: ColKey) {
    if (k === "name") return; // Name always visible
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
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
        <div className="flex min-w-0 items-center gap-1.5 text-zinc-200">
          {fav && <span className="shrink-0 text-amber-400">★</span>}
          <span className="truncate">{nameOf(r)}</span>
        </div>
      );
    }
    if (key === "file") return <div className="truncate text-zinc-600">{r.file}</div>;
    if (key === "size") return <div className="tabular-nums text-zinc-500">{fmtSize(r.size)}</div>;
    if (key === "kind") return <div className="truncate text-[10px] uppercase tracking-wide text-zinc-500">{r.kind}</div>;
    return <div className="truncate tabular-nums text-zinc-500">{fmtDate(key === "modified" ? r.modified : r.created)}</div>;
  }

  if (rows.length === 0)
    return <p className="px-2 py-10 text-center font-mono text-[12px] text-zinc-600">No files</p>;

  return (
    <div className="scrollbar-none -mr-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden pr-2">
      <div className="scrollbar-none min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <table className="w-full table-fixed border-collapse font-mono text-[11px]">
          <colgroup>
            {visible.map((k) => <col key={k} style={COLS[k].width ? { width: COLS[k].width! } : undefined} />)}
            <col style={{ width: ACTION_W }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-zinc-950">
            <tr>
              {visible.map((k) => {
                const c = COLS[k];
                const active = sort.key === k;
                return (
                  <th
                    key={k}
                    onClick={() => clickSort(k)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, kind: "cols" }); }}
                    title="Click to sort · right-click for columns"
                    className={`group/h cursor-pointer select-none whitespace-nowrap border-b border-zinc-800 px-2.5 py-2 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors ${c.align === "right" ? "text-right" : "text-left"} ${active ? "text-zinc-300" : "text-zinc-600 hover:text-zinc-400"}`}
                  >
                    {c.label}
                    <span className={`ml-1 inline-block ${active ? "text-zinc-500" : "text-transparent group-hover/h:text-zinc-700"}`}>
                      {active ? (sort.dir === "asc" ? "▲" : "▼") : "▼"}
                    </span>
                  </th>
                );
              })}
              <th
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, kind: "cols" }); }}
                className="select-none border-b border-zinc-800 px-2.5 py-2 text-right text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-600"
              >
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
                className="group/row cursor-pointer border-b border-zinc-900/70 text-zinc-300 transition-colors hover:bg-zinc-900"
              >
                {visible.map((k) => (
                  <td key={k} className={`px-2.5 py-2 align-middle ${COLS[k].align === "right" ? "text-right" : ""}`}>
                    {renderCell(r, k)}
                  </td>
                ))}
                <td className="px-1.5 py-2 text-right align-middle">
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
              <span className="w-3 text-emerald-400">{!hidden.has(k) ? "✓" : ""}</span>
              {COLS[k].label}
            </button>
          ))}
        </div>
      )}

      {/* row actions — file-appropriate, same set as a right-click on the row */}
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
