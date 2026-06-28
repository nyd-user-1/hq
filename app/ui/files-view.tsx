"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SearchField from "@/app/ui/search-field";
import TerminalNavMenu from "@/app/ui/terminal-nav-menu";
import CmdkFilesTable, { type FilesMeta } from "@/app/ui/cmdk-files-table";
import type { FileRow } from "@/lib/files-index";

// The full-width Files browser — HQ's macOS-Finder over every file Claude wrote to
// disk (~/.claude transcripts/memory/notes/skills + the repo source). Lives in the
// center column as an overlay (files-overlay.tsx) so the terminal stays mounted
// underneath. Modelled on the new-session session table: a header (mirroring the
// terminal's "● label — nav" header) + a recent-files chip band (the parallel to
// new-session's project chips) + a filter box + the sortable, windowed table.

// Open a row in the /search panel reader. KEEPS ?center=files so the files table
// stays in the center and the reader opens in the RIGHT panel — no jump back to
// the terminal (the thing that made the old behavior feel like the page bailed).
// Carries the terminal pins so a paired terminal isn't dropped.
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
  const pins = (["session", "wall"] as const)
    .map((k) => (cur.get(k) ? `${k}=${cur.get(k)}` : ""))
    .filter(Boolean)
    .join("&");
  return `/search?center=files&scope=all&sort=new&${op}${pins ? `&${pins}` : ""}`;
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
  // Centered "conversation shell" ↔ wide, mirroring the terminal's focus toggle.
  // Default WIDE: the 6-column table wants the room the overlay gives it; the
  // toggle centers it into the reading column for anyone who prefers that.
  const [focusMode, setFocusMode] = useState(true); // start in focus mode, like a session

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

  // Recent files — the parallel to new-session's project chips. Newest-created
  // first; click opens the file (no jump, see openHref). Basename labels.
  const recent = useMemo(
    () => [...rows].sort((a, b) => b.created - a.created).slice(0, 16),
    [rows],
  );

  // close = drop ?center, keep everything else (pins + any open panel)
  const close = () => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("center");
    router.push(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };
  const onOpen = (r: FileRow) => router.push(openHref(r, `?${params.toString()}`), { scroll: false });

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col gap-3 font-mono ${
        focusMode ? "mx-auto w-full max-w-3xl" : ""
      }`}
    >
      {/* header — mirrors the terminal's new-session header: ● files — [nav], with
          the × close + the focus (center ↔ wide) toggle on the right. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800/60 pb-3">
        <span className="flex items-center gap-1.5 text-xs">
          <span className="size-2 shrink-0 rounded-full bg-emerald-500/80" />
          <span className="font-mono text-zinc-300">files</span>
        </span>
        <TerminalNavMenu project="" sessionId={null} />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            onClick={close}
            aria-label="Close files"
            title="Close files"
            className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setFocusMode((f) => !f)}
            aria-label={focusMode ? "Wide screen" : "Focus mode"}
            title={focusMode ? "Wide screen" : "Focus mode"}
            className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            {focusMode ? (
              // lucide maximize-2 — expand back out to wide
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" x2="14" y1="3" y2="10" />
                <line x1="3" x2="10" y1="21" y2="14" />
              </svg>
            ) : (
              // lucide minimize-2 — shrink into the centered focus column
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" x2="21" y1="10" y2="3" />
                <line x1="3" x2="10" y1="21" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* recent files — the parallel to new-session's project chips: a 2-row band
          that scrolls horizontally, basename labels, click opens the file. */}
      {!loading && recent.length > 0 && (
        <div className="scrollbar-none mt-3 grid grid-flow-col grid-rows-2 auto-cols-[9rem] gap-2 overflow-x-auto pb-1">
          {recent.map((r) => (
            <button
              key={`${r.kind}:${r.ref}`}
              type="button"
              onClick={() => onOpen(r)}
              title={`${meta[`${r.kind}:${r.ref}`]?.title || r.name}\n${r.file}`}
              className="flex h-9 items-center rounded-md border border-zinc-800 px-2 text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
            >
              <span className="w-full truncate text-center text-[11px]">
                {r.file.split("/").pop() || r.file}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* filter */}
      <SearchField
        value={q}
        onChange={setQ}
        placeholder="Filter files by name or path…"
        className="mt-3 max-w-md"
      />

      {/* table — windowed; fills the rest */}
      {loading ? <Skeleton /> : <CmdkFilesTable rows={filtered} meta={meta} onOpen={onOpen} />}
    </div>
  );
}
