"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SearchField from "@/app/ui/search-field";
import TerminalNavMenu from "@/app/ui/terminal-nav-menu";
import CmdkFilesTable, { type FilesMeta } from "@/app/ui/cmdk-files-table";
import ProjectSessions from "@/app/ui/project-sessions";
import { ClaudeMark, GitMark, GitHubMark } from "@/app/ui/brand-marks";
import type { FileRow } from "@/lib/files-index";
import type { ProjectKind, ProjectSummary } from "@/lib/projects";
import type { RecentSession } from "@/lib/sessions";

// PROJECTS browser — the Files Finder table (files + rich session rows), PLUS a
// project strip at the top: click a project and the table swaps (behind a skeleton)
// for that project's session list (ProjectSessions); the ← arrow returns. Lives in
// the center overlay (project-overlay.tsx); the terminal stays mounted underneath.

type Sess = {
  id: string;
  project: string;
  title: string;
  customTitle: string;
  snippet: string;
  lastActive: number;
};

// Open a row in the /search panel reader — keeps ?center so the table stays put and
// the reader opens in the RIGHT panel; carries the pins.
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
  return `/search?center=project&scope=all&sort=new&${op}${pins ? `&${pins}` : ""}`;
}

// kind icon for the project-strip chips (matches the projects panel vocabulary).
function KindMark({ kind }: { kind: ProjectKind }) {
  if (kind === "github") return <GitHubMark size={12} className="shrink-0 text-zinc-300" />;
  if (kind === "git") return <GitMark size={12} className="shrink-0" />;
  if (kind === "temp")
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  return <ClaudeMark size={12} className="shrink-0 text-[#d97757]" />;
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

export default function ProjectView() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname() ?? "/";
  const [rows, setRows] = useState<FileRow[]>([]);
  const [meta, setMeta] = useState<FilesMeta>({});
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [focusMode, setFocusMode] = useState(true); // start in focus mode, like a session
  // drill-down: a project's session list swaps in for the table.
  const [selected, setSelected] = useState<string | null>(null);
  const [drill, setDrill] = useState<RecentSession[] | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetch("/api/files-all").then((r) => r.json()).catch(() => ({})),
      fetch("/api/sessions/all").then((r) => r.json()).catch(() => ({})),
    ]).then(([f, s]) => {
      if (!alive) return;
      const fileRows: FileRow[] = Array.isArray(f?.rows) ? f.rows : [];
      const sessions: Sess[] = Array.isArray(s?.sessions) ? s.sessions : [];
      const ids = new Set(sessions.map((x) => x.id));
      const sessionRows: FileRow[] = sessions.map((x) => ({
        kind: "session",
        ref: x.id,
        name: x.customTitle || x.title || x.snippet || x.id.slice(0, 8),
        file: x.project,
        modified: x.lastActive,
        created: x.lastActive,
        size: -1,
        meta: x.project,
      }));
      const files = fileRows.filter((r) => !ids.has(r.ref));
      setRows([...sessionRows, ...files]);
      setLoading(false);
    });
    fetch("/api/file-meta")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setMeta(d?.files ?? {});
      })
      .catch(() => {});
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setProjects(Array.isArray(d?.projects) ? d.projects : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // fetch the selected project's sessions for the drill-down.
  useEffect(() => {
    if (!selected) {
      setDrill(null);
      return;
    }
    let alive = true;
    setDrill(null);
    fetch(`/api/projects?name=${encodeURIComponent(selected)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => alive && setDrill(d?.sessions ?? []))
      .catch(() => alive && setDrill([]));
    return () => {
      alive = false;
    };
  }, [selected]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((r) => {
      const name = (meta[`${r.kind}:${r.ref}`]?.title || r.name || r.ref).toLowerCase();
      return name.includes(query) || r.file.toLowerCase().includes(query);
    });
  }, [rows, q, meta]);

  const recent = useMemo(() => [...rows].sort((a, b) => b.created - a.created).slice(0, 16), [rows]);

  const close = () => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("center");
    router.push(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };
  const onOpen = (r: FileRow) => router.push(openHref(r, `?${params.toString()}`), { scroll: false });
  const pickSession = (id: string) =>
    router.push(openHref({ kind: "session", ref: id } as FileRow, `?${params.toString()}`), { scroll: false });

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-3 font-mono ${focusMode ? "mx-auto w-full max-w-3xl" : ""}`}>
      {/* header — ● projects · ⋮ kebab, close + focus right */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800/60 pb-3">
        <span className="flex items-center gap-1.5 text-xs">
          <span className="size-2 shrink-0 rounded-full bg-emerald-500/80" />
          <span className="font-mono text-zinc-300">projects</span>
        </span>
        <TerminalNavMenu project="" sessionId={null} />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button onClick={close} aria-label="Close projects" title="Close projects" className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <button type="button" onClick={() => setFocusMode((f) => !f)} aria-label={focusMode ? "Wide screen" : "Focus mode"} title={focusMode ? "Wide screen" : "Focus mode"} className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
            {focusMode ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" x2="14" y1="3" y2="10" />
                <line x1="3" x2="10" y1="21" y2="14" />
              </svg>
            ) : (
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

      {selected ? (
        // drill-down — a project's sessions; ← returns to the table
        drill ? (
          <ProjectSessions name={selected} sessions={drill} onBack={() => setSelected(null)} onPick={pickSession} />
        ) : (
          <Skeleton />
        )
      ) : (
        <>
          {/* project strip — click a project to drill into its sessions */}
          {projects.length > 0 && (
            <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
              {projects.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setSelected(p.name)}
                  title={`${p.name} · ${p.sessions} sessions`}
                  className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-zinc-800 px-2.5 text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  <KindMark kind={p.kind} />
                  <span className="max-w-[10rem] truncate text-[11px]">{p.name}</span>
                  <span className="font-mono text-[10px] text-zinc-600">{p.sessions}</span>
                </button>
              ))}
            </div>
          )}

          {/* recent — newest files + sessions; click opens in the reader */}
          {!loading && recent.length > 0 && (
            <div className="scrollbar-none grid grid-flow-col grid-rows-2 auto-cols-[9rem] gap-2 overflow-x-auto pb-1">
              {recent.map((r) => (
                <button
                  key={`${r.kind}:${r.ref}`}
                  type="button"
                  onClick={() => onOpen(r)}
                  title={`${meta[`${r.kind}:${r.ref}`]?.title || r.name}\n${r.file}`}
                  className="flex h-9 items-center rounded-md border border-zinc-800 px-2 text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
                >
                  <span className="w-full truncate text-center text-[11px]">{r.name || r.file.split("/").pop() || r.file}</span>
                </button>
              ))}
            </div>
          )}

          {/* filter */}
          <SearchField value={q} onChange={setQ} placeholder="Filter files & sessions by name or path…" className="max-w-md" />

          {/* table — the Files Finder table, carrying files + sessions */}
          {loading ? <Skeleton /> : <CmdkFilesTable rows={filtered} meta={meta} onOpen={onOpen} />}
        </>
      )}
    </div>
  );
}
