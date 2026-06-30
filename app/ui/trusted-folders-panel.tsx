"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useTrustedFolders } from "@/app/ui/trusted-folders-state";

// Inlined to match the /api/trusted-folders JSON shape — NOT imported from
// lib/trusted-folders (a node:fs reader), so Turbopack never drags fs into this
// client bundle.
type TrustedFolder = { path: string; trusted?: boolean };

// Tilde-collapse the home prefix so the home dir reads as "~" and the list stays
// scannable — display only; the full path stays in the title + copy.
function shortPath(p: string): string {
  const m = p.match(/^\/Users\/[^/]+(\/.*)?$/);
  if (m) return `~${m[1] ?? ""}`;
  return p;
}
const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// The Trusted Folders panel — every project directory Claude Code knows about
// (read from ~/.claude.json's `projects` map), each marked trusted or not. A
// standalone toggle panel (its own portal root #trusted-folders-panel-root),
// mirroring Permissions/Changelog: AppPanel chrome + a live /api/trusted-folders
// fetch. Read-only: HQ reflects the on-disk trust state, the CLI is the writer.
export default function TrustedFoldersPanel() {
  const { open, setOpen } = useTrustedFolders();
  const [folders, setFolders] = useState<TrustedFolder[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/trusted-folders", { cache: "no-store" }).then((res) => res.json());
      if (r.error) throw new Error(r.error);
      setFolders(r.folders ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const query = q.trim().toLowerCase();
  const shown = useMemo(
    () => folders.filter((f) => !query || f.path.toLowerCase().includes(query)),
    [folders, query],
  );
  const trustedCount = useMemo(() => folders.filter((f) => f.trusted).length, [folders]);

  return (
    <AppPanel
      rootId="trusted-folders-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="trusted-folders-panel.tsx">
        {/* search + refresh */}
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={folders.length ? `Search ${folders.length} folders…` : "Search folders…"}
            className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          <button
            onClick={() => load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            <svg className={loading ? "animate-spin" : ""} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">{err}</p>
        )}

        {/* list */}
        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-2">
          {shown.length ? (
            shown.map((f) => <FolderRow key={f.path} f={f} />)
          ) : (
            <p className="px-0.5 font-mono text-[11px] text-zinc-600">
              {loading ? "loading…" : query ? `no folders match “${q}”.` : "no known project folders in ~/.claude.json."}
            </p>
          )}
        </div>

        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {folders.length
            ? `${trustedCount} of ${folders.length} trusted · from ~/.claude.json. The CLI sets trust; HQ reflects it.`
            : "Reads ~/.claude.json — the folders Claude Code knows about."}
        </footer>
      </Boundary>
    </AppPanel>
  );
}

// One folder row: a trust dot, the folder's basename, its (tilde-collapsed) path,
// and a trust badge on the right.
function FolderRow({ f }: { f: TrustedFolder }) {
  return (
    <div className="rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5" title={f.path}>
      <div className="flex items-center gap-2">
        <span
          className={`shrink-0 text-[10px] leading-none ${f.trusted ? "text-emerald-500" : "text-zinc-600"}`}
          aria-hidden
        >
          ●
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-zinc-200">{baseName(f.path)}</span>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${
            f.trusted
              ? "border-emerald-500/40 text-emerald-300"
              : "border-zinc-700 text-zinc-500"
          }`}
        >
          {f.trusted ? "trusted" : f.trusted === false ? "untrusted" : "unknown"}
        </span>
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-zinc-500">{shortPath(f.path)}</div>
    </div>
  );
}
