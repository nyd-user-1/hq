"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type ProjectSummary = {
  name: string;
  kind: "claude" | "git" | "github" | "temp";
  sessions: number;
  lastActive: number;
  active: boolean;
};

// Projects nav item — the label opens the Projects browser in Terminal 1
// (?session=@projects); the chevron expands an inline list of the projects (most
// recent first), each drilling into that project (?project=<name>). The list is
// lazy — fetched from /api/projects the first time it's expanded.
export default function ProjectsItem() {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const active = params.get("session") === "@projects";

  const [expanded, setExpanded] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    if (!expanded || projects) return;
    let alive = true;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => { if (alive) setProjects(Array.isArray(d?.projects) ? d.projects : []); })
      .catch(() => { if (alive) setProjects([]); });
    return () => { alive = false; };
  }, [expanded, projects]);

  // Label click: open @projects, or drop to home if it's already the surface.
  const openSp = new URLSearchParams(params.toString());
  openSp.delete("center");
  openSp.delete("lead");
  if (active) openSp.delete("session");
  else openSp.set("session", "@projects");
  const openHref = `${pathname}${openSp.toString() ? `?${openSp}` : ""}`;

  // A single project row → drill into it (@projects browser, ?project=<name>).
  const projectHref = (name: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("center");
    sp.delete("lead");
    sp.set("session", "@projects");
    sp.set("project", name);
    return `${pathname}?${sp}`;
  };

  const rows = (projects ?? [])
    .slice()
    .sort((a, b) => b.lastActive - a.lastActive)
    .slice(0, 10);

  return (
    <div className="flex flex-col">
      <div
        className={`flex items-center gap-1 rounded-md text-xs font-medium transition-colors ${
          active ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        }`}
      >
        <Link href={openHref} scroll={false} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5">
          {/* lucide Folder */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          </svg>
          Projects
        </Link>
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse projects" : "Expand projects"}
          aria-expanded={expanded}
          className="shrink-0 rounded p-1 pr-2 opacity-70 transition-opacity hover:opacity-100"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="mt-0.5 ml-[1.125rem] flex flex-col border-l border-zinc-800 pl-1.5">
          {projects === null ? (
            <span className="px-2 py-1 text-[11px] text-zinc-600">Loading…</span>
          ) : rows.length === 0 ? (
            <span className="px-2 py-1 text-[11px] text-zinc-600">No projects</span>
          ) : (
            rows.map((p) => (
              <Link
                key={p.name}
                href={projectHref(p.name)}
                scroll={false}
                className="flex items-center gap-2 rounded px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              >
                <span className={`size-1.5 shrink-0 rounded-full ${p.active ? "bg-emerald-500" : "bg-zinc-700"}`} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
