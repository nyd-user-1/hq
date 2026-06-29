"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import ProjectsView from "@/app/ui/projects-view";
import ProjectSessions from "@/app/ui/project-sessions";

// The center "Projects browser" overlay — standardized to the SAME universal model
// as the projects panel: Claude's cwd buckets, typed Claude/Git/GitHub/Temp, with
// the kind icon in each card's corner, the kind filter, and a guarded Temp delete.
// Just full-width (the overlay gives it room). Renders the shared ProjectsView card
// grid + the in-panel session drill-down. (Was a Files+sessions Finder table; that
// file/session browser still lives in the Files overlay.)
export default function ProjectView() {
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
    load();
  }, [load]);

  // drill-down: the selected project's sessions
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

  // pin a session in the terminal (?session on the current URL; overlay stays).
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

  if (selected) {
    return sessions ? (
      <ProjectSessions name={selected} sessions={sessions} onBack={() => setSelected(null)} onPick={pin} />
    ) : (
      <p className="font-mono text-[11px] text-zinc-600">loading…</p>
    );
  }
  return projects ? (
    <ProjectsView projects={projects} onSelect={setSelected} onDelete={remove} />
  ) : (
    <p className="font-mono text-[11px] text-zinc-600">{loading ? "loading…" : "no projects"}</p>
  );
}
