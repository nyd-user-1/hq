"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import SearchField from "@/app/ui/search-field";
import SortIcon from "@/app/ui/sort-icon";
import type { ProjectSummary } from "@/lib/projects";

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// Projects landing, claude.ai-style: a header (title · sort · new), a search box,
// then a card grid of sessions grouped by their derived project. Search + sort are
// client-side over the server-provided list. "New project" is a placeholder until
// curated projects (the ~/.claude/hq sidecar) land.
export default function ProjectsView({
  projects,
}: {
  projects: ProjectSummary[];
}) {
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<"new" | "old">("new");
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
    const filtered = needle
      ? projects.filter((p) => p.name.toLowerCase().includes(needle))
      : projects;
    return [...filtered].sort((a, b) =>
      dir === "new" ? b.lastActive - a.lastActive : a.lastActive - b.lastActive
    );
  }, [projects, q, dir]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setDir((d) => (d === "new" ? "old" : "new"))}
          title={
            dir === "new"
              ? "Newest first — click for oldest"
              : "Oldest first — click for newest"
          }
          aria-label="Toggle sort order"
          className="ml-auto flex shrink-0 items-center rounded-md bg-zinc-800 px-2 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
        >
          <SortIcon dir={dir} />
        </button>
        <button
          title="New project — curated projects coming next"
          aria-label="New project"
          className="flex shrink-0 items-center rounded-md bg-zinc-800 px-2 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      <SearchField value={q} onChange={setQ} placeholder="Search projects…" />

      {shown.length === 0 ? (
        <p className="text-xs text-zinc-600">
          {q
            ? `no projects matching “${q}”`
            : "no projects yet — no sessions in the last 7 days"}
        </p>
      ) : (
        <ul className="scrollbar-none grid min-h-0 flex-1 grid-cols-1 content-start gap-2 overflow-y-auto sm:grid-cols-2">
          {shown.map((p) => (
            <li key={p.name}>
              <Link
                href={cardHref(p.name)}
                scroll={false}
                className="flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2.5 transition-colors hover:border-zinc-600 hover:bg-zinc-900/40"
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className={`size-2 self-center rounded-full ${
                      p.active ? "bg-green-500" : "bg-zinc-700"
                    }`}
                  />
                  <span className="truncate text-sm font-medium text-zinc-200">
                    {p.name}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-600">
                    {p.sessions} {p.sessions === 1 ? "session" : "sessions"}
                  </span>
                </div>
                <p className="font-mono text-xs text-zinc-500">
                  updated {ago(p.lastActive)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-zinc-600">
        sessions grouped by project — launch folder or an early code/&lt;slug&gt;
        reference, last 7 days · auto-derived · green dot = active now
      </p>
    </div>
  );
}
