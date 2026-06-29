"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import ProjectsView from "@/app/ui/projects-view";
import { useProjectsPanel } from "@/app/ui/projects-panel-state";

// Standalone Projects panel — the skills-panel push-in standard. The same
// ProjectsView grid the @panel/projects route renders, fed client-side from GET
// /api/projects. (Card drill-down still navigates the @panel/projects route for
// now — intentional duplicate during the review period.)
export default function ProjectsPanel() {
  const { open, setOpen } = useProjectsPanel();
  const [projects, setProjects] = useState<ComponentProps<typeof ProjectsView>["projects"] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/projects", { cache: "no-store" }).then((res) => res.json());
      setProjects(r?.projects ?? []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <AppPanel rootId="projects-panel-root" open={open} onClose={() => setOpen(false)} widthClass="sm:w-[min(360px,40vw)]">
      <Boundary label="projects-panel.tsx">
        {projects ? (
          <div className="scrollbar-none -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            <ProjectsView projects={projects} />
          </div>
        ) : (
          <p className="font-mono text-[11px] text-zinc-600">{loading ? "loading…" : "no projects"}</p>
        )}
      </Boundary>
    </AppPanel>
  );
}
