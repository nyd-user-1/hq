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

// Projects landing, claude.ai-style: a full-width search box, then a control row
// — "+" (new, left) and a no-dropdown "Sort" toggle (newest/oldest, right) —
// then a card grid of sessions grouped by their derived project, with the
// "*Sessions grouped by project." caption as a footer. Projects is the only view
// that keeps a sort. "New project" is a placeholder until curated projects land.
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
    <div className="@container flex min-h-0 flex-1 flex-col gap-3">
      {/* Search header, components-page layout: full-width search, then a hint
          row — text left, the sort + new buttons grouped on the right. */}
      <div className="flex flex-col gap-1.5">
        <SearchField value={q} onChange={setQ} placeholder="Search projects…" />
        <div className="flex items-center gap-2">
          {/* + on the LEFT */}
          <button
            title="New project — curated projects coming next"
            aria-label="New project"
            className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
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
          {/* Sort on the RIGHT — Filter-button styling, but no dropdown: Projects
              is the only view that keeps a sort, a newest/oldest toggle. */}
          <button
            onClick={() => setDir((d) => (d === "new" ? "old" : "new"))}
            title={
              dir === "new"
                ? "Newest first — click for oldest"
                : "Oldest first — click for newest"
            }
            aria-label="Toggle sort order"
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Sort
            <SortIcon dir={dir} />
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-zinc-600">
          {q
            ? `no projects matching “${q}”`
            : "no projects yet — no sessions in the last 7 days"}
        </p>
      ) : (
        <ul className="scrollbar-none grid min-h-0 flex-1 grid-cols-1 content-start gap-2 overflow-y-auto @md:grid-cols-2">
          {shown.map((p) => (
            <li key={p.name}>
              <Link
                href={cardHref(p.name)}
                scroll={false}
                className="flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2.5 transition-colors hover:border-zinc-600 hover:bg-zinc-900/40"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      p.active ? "bg-green-500" : "bg-zinc-700"
                    }`}
                  />
                  <span className="break-words text-sm font-medium text-zinc-200">
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

      {/* Caption footer — relocated to the foot of the panel (matches To Do). */}
      <p className="text-xs text-zinc-600">*Sessions grouped by project.</p>
    </div>
  );
}
