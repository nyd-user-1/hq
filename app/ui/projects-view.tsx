"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SearchField from "@/app/ui/search-field";
import SortIcon from "@/app/ui/sort-icon";
import { ClaudeMark, GitMark, GitHubMark } from "@/app/ui/brand-marks";
import type { ProjectSummary, ProjectKind } from "@/lib/projects";

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// The kind mark in front of a project: GitHub (on GitHub) · Git (local repo,
// not pushed) · Claude (folder / conversation, no repo) · Temp (ephemeral).
function KindMark({ kind }: { kind: ProjectKind }) {
  if (kind === "github") return <GitHubMark size={14} className="shrink-0 text-zinc-300" />;
  if (kind === "git") return <GitMark size={14} className="shrink-0" />;
  if (kind === "temp")
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-500" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  return <ClaudeMark size={14} className="shrink-0 text-[#d97757]" />; // Claude clay
}

const KIND_FILTERS: { key: "all" | ProjectKind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "claude", label: "Claude" },
  { key: "git", label: "Git" },
  { key: "github", label: "GitHub" },
  { key: "temp", label: "Temp" },
];

// Short, native (never-clipped) tooltip per kind — sits on the corner icon.
const KIND_LABEL: Record<ProjectKind, string> = {
  github: "On GitHub — git repo with a github.com remote",
  git: "Local git repo — committed, not pushed to GitHub",
  claude: "Claude — a folder/conversation, no git repo",
  temp: "Temporary — ephemeral dir; delete to reclaim disk",
};

// Projects landing, claude.ai-style: a full-width search box, a control row (+ /
// Sort) and a kind filter, then a card grid grouped by Claude's own cwd buckets,
// each stamped with its kind icon. Temp buckets carry a guarded Delete (reclaim
// disk). The "*Sessions grouped by project." caption is the footer.
export default function ProjectsView({
  projects,
  onSelect,
  onDelete,
}: {
  projects: ProjectSummary[];
  // Standalone panel passes these to drill / delete in-panel; the @panel route
  // omits them and keeps the URL <Link> (?project=…). Card body is shared.
  onSelect?: (name: string) => void;
  onDelete?: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<"new" | "old">("new");
  const [kind, setKind] = useState<"all" | ProjectKind>("all");
  const params = useSearchParams();

  // Click a card → drill into that project's sessions (?project=<name>), keeping
  // the terminal pins (?session/?pair) so the terminal never unpins.
  const cardHref = (name: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("project", name);
    return `/projects?${sp.toString()}`;
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = projects.filter(
      (p) => (kind === "all" || p.kind === kind) && (!needle || p.name.toLowerCase().includes(needle)),
    );
    return [...filtered].sort((a, b) =>
      dir === "new" ? b.lastActive - a.lastActive : a.lastActive - b.lastActive
    );
  }, [projects, q, dir, kind]);

  return (
    <div className="@container flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <SearchField value={q} onChange={setQ} placeholder="Search projects…" />
        <div className="flex items-center gap-2">
          {/* + on the LEFT */}
          <button
            title="New project — curated projects coming next"
            aria-label="New project"
            className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
          {/* Sort on the RIGHT — newest/oldest toggle (Projects keeps a sort). */}
          <button
            onClick={() => setDir((d) => (d === "new" ? "old" : "new"))}
            title={dir === "new" ? "Newest first — click for oldest" : "Oldest first — click for newest"}
            aria-label="Toggle sort order"
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Sort
            <SortIcon dir={dir} />
          </button>
        </div>
        {/* kind filter — All · Claude · Git · GitHub · Temp */}
        <div className="scrollbar-none flex items-center gap-1 overflow-x-auto">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setKind(f.key)}
              className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                kind === f.key
                  ? "border-zinc-200 bg-zinc-200 text-zinc-900"
                  : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-zinc-600">
          {q ? `no projects matching “${q}”` : kind !== "all" ? `no ${kind} projects` : "no projects yet"}
        </p>
      ) : (
        <ul className="scrollbar-none grid min-h-0 flex-1 grid-cols-1 content-start gap-2 overflow-y-auto @md:grid-cols-2">
          {shown.map((p) => {
            const cardCls =
              "relative flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2.5 text-left transition-colors hover:border-zinc-600 hover:bg-zinc-900/40";
            const body = (
              <>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="break-words text-sm font-medium text-zinc-200">{p.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-600">
                    {p.sessions} {p.sessions === 1 ? "session" : "sessions"}
                  </span>
                </div>
                <p className="pr-7 font-mono text-xs text-zinc-500">updated {ago(p.lastActive)}</p>
                {/* kind icon — bottom-right corner, native (never-clipped) tooltip */}
                <span title={KIND_LABEL[p.kind]} className="absolute bottom-2 right-2.5 text-zinc-500">
                  <KindMark kind={p.kind} />
                </span>
              </>
            );
            return (
              <li key={p.name}>
                {onSelect ? (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(p.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(p.name);
                      }
                    }}
                    className={`group relative w-full cursor-pointer ${cardCls}`}
                  >
                    {body}
                    {onDelete && p.kind === "temp" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete the temp project “${p.name}” and reclaim its transcripts from ~/.claude/projects? This can't be undone.`))
                            onDelete(p.name);
                        }}
                        title="Delete — reclaim disk"
                        aria-label="Delete temp project"
                        className="absolute right-2 top-2 rounded p-1 text-zinc-600 opacity-0 transition hover:bg-zinc-800 hover:text-red-300 group-hover:opacity-100"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M3 6h18" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                ) : (
                  <Link href={cardHref(p.name)} scroll={false} className={cardCls}>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-zinc-600">*Sessions grouped by project.</p>
    </div>
  );
}
