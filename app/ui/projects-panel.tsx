"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import ProjectsView from "@/app/ui/projects-view";
import ProjectSessions from "@/app/ui/project-sessions";
import { useProjectsPanel } from "@/app/ui/projects-panel-state";

// Standalone Projects panel — the skills-panel push-in standard. The grid AND the
// per-project session drill-down both live IN the panel (client state), so a card
// click never leaves for the @panel/projects route. Data via GET /api/projects
// (grid) and GET /api/projects?name=… (a project's sessions). Picking a session
// pins it in the terminal (?session on the current URL — the panel stays open).
export default function ProjectsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { open, setOpen } = useProjectsPanel();
  const active = embedded || open;
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const [projects, setProjects] = useState<ComponentProps<typeof ProjectsView>["projects"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ComponentProps<typeof ProjectSessions>["sessions"] | null>(null);

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
    if (active) load();
  }, [active, load]);

  // drill-down: fetch the selected project's sessions
  useEffect(() => {
    if (!selected) {
      setSessions(null);
      return;
    }
    let cancelled = false;
    setSessions(null);
    fetch(`/api/projects?name=${encodeURIComponent(selected)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => !cancelled && setSessions(d?.sessions ?? []))
      .catch(() => !cancelled && setSessions([]));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // pin a session in the terminal — set ?session on the current URL. The panel is
  // client state, so this switches the terminal without closing the panel.
  const pin = (id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("session", id);
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  // delete a TEMP project's transcripts (guarded server-side to temp-only) + reload.
  const remove = async (name: string) => {
    await fetch("/api/projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => {});
    load();
  };

  const content = (
    <>
      {selected ? (
        sessions ? (
          <ProjectSessions name={selected} sessions={sessions} onBack={() => setSelected(null)} onPick={pin} />
        ) : (
          <p className="font-mono text-[11px] text-zinc-600">loading…</p>
        )
      ) : projects ? (
        <ProjectsView projects={projects} onSelect={setSelected} onDelete={remove} />
      ) : (
        <p className="font-mono text-[11px] text-zinc-600">{loading ? "loading…" : "no projects"}</p>
      )}
    </>
  );
  if (embedded) return content;
  return (
    <AppPanel
      rootId="projects-panel-root"
      open={open}
      onClose={() => {
        setOpen(false);
        setSelected(null);
      }}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="projects-panel.tsx">{content}</Boundary>
    </AppPanel>
  );
}
