"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SearchField from "@/app/ui/search-field";
import CmdkFilesTable, { type FilesMeta } from "@/app/ui/cmdk-files-table";
import type { FileRow } from "@/lib/files-index";

// The full-width Files browser — HQ's macOS-Finder over every file Claude wrote to
// disk (~/.claude transcripts/memory/notes/skills + the repo source). Lives in the
// center column as an overlay (files-overlay.tsx) so the terminal stays mounted
// underneath. Modelled on the new-session session table: a header + a filter box +
// the sortable, windowed table. NOT in ⌘K — that stays a fast launcher; this is
// where you BROWSE (the table windows its rows, so corpus size never costs DOM).

// Open a row in the /search panel reader, carrying the terminal pins and dropping
// ?center so the terminal reappears with the panel showing the item.
function openHref(r: FileRow, search: string): string {
  const e = encodeURIComponent;
  const op =
    r.kind === "session" || r.kind === "sdk" || r.kind === "transcript"
      ? `openSession=${e(r.ref)}`
      : r.kind === "note"
        ? `openNote=${e(r.ref)}`
        : r.kind === "memory"
          ? `open=${e(r.ref)}`
          : r.kind === "skill"
            ? `openSkill=${e(r.ref)}`
            : `openFile=${e(r.ref)}`;
  const cur = new URLSearchParams(search);
  const pins = (["session", "pair"] as const)
    .map((k) => (cur.get(k) ? `${k}=${cur.get(k)}` : ""))
    .filter(Boolean)
    .join("&");
  return `/search?scope=all&sort=new&${op}${pins ? `&${pins}` : ""}`;
}

function Skeleton() {
  return (
    <div className="flex flex-1 flex-col gap-2 pt-2">
      {[92, 70, 84, 60, 78, 66, 88, 72].map((w, i) => (
        <div key={i} className="h-6 animate-pulse rounded bg-zinc-900" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export default function FilesView() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname() ?? "/";
  const [rows, setRows] = useState<FileRow[]>([]);
  const [meta, setMeta] = useState<FilesMeta>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch("/api/files-all")
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          setRows(Array.isArray(d?.rows) ? d.rows : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setRows([]);
          setLoading(false);
        }
      });
    fetch("/api/file-meta")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setMeta(d?.files ?? {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((r) => {
      const name = (meta[`${r.kind}:${r.ref}`]?.title || r.name || r.ref).toLowerCase();
      return name.includes(query) || r.file.toLowerCase().includes(query);
    });
  }, [rows, q, meta]);

  // close = drop ?center, keep everything else (pins + any open panel)
  const close = () => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("center");
    router.push(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };
  const onOpen = (r: FileRow) => router.push(openHref(r, `?${params.toString()}`), { scroll: false });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 font-mono">
      {/* header — mirrors the terminal's session header (● label · count) */}
      <div className="flex items-center gap-2.5 border-b border-zinc-800/60 pb-3 text-[13px]">
        <span className="size-2 shrink-0 rounded-full bg-emerald-500/80" />
        <span className="text-zinc-200">files</span>
        <span className="text-zinc-600">· {filtered.length}{q.trim() ? ` of ${rows.length}` : ""}</span>
        <button
          onClick={close}
          aria-label="Close files"
          title="Close files"
          className="ml-auto flex shrink-0 items-center rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* filter */}
      <SearchField
        value={q}
        onChange={setQ}
        placeholder="Filter files by name or path…"
        className="max-w-md"
      />

      {/* table — windowed; fills the rest */}
      {loading ? <Skeleton /> : <CmdkFilesTable rows={filtered} meta={meta} onOpen={onOpen} />}
    </div>
  );
}
