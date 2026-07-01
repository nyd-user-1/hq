"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import NewSessionItem from "@/app/ui/new-session-item";
import ProjectsItem from "@/app/ui/projects-item";
import FilesItem from "@/app/ui/files-item";
import FleetItem from "@/app/ui/fleet-item";
import AgentTeamsItem from "@/app/ui/agent-teams-item";
import SidebarRecents from "@/app/ui/sidebar-recents";
import AccountChip from "@/app/ui/account-chip";

const TEAMS_OPEN_KEY = "hq:agent-teams-open";

// Left rail. Brand → "/" (closes the panel, terminal-only focus). "New Session"
// is the primary action. The panel groups (Activity/Metrics/Console) live in the
// terminal's "panels" dropdown, so the sidebar is New Session + the nav items +
// Recent Sessions (Claude-style). "Agent Teams" is a top-group item that reveals
// the live teams' lead sessions in Recents (they render there so they get the full
// session-row treatment).
export default function Sidebar() {
  const [teamsOpen, setTeamsOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(TEAMS_OPEN_KEY) === "0") setTeamsOpen(false);
    } catch {
      /* no storage — default open */
    }
  }, []);
  const toggleTeams = () =>
    setTeamsOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(TEAMS_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Brand chip — same thin border / resting-bg / hover as the account chip. */}
      <Link
        href="/"
        scroll={false}
        className="block shrink-0 rounded-lg px-2.5 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
      >
        <h1 className="text-base font-normal tracking-tight">hq/terminal</h1>
      </Link>

      <div className="flex shrink-0 flex-col gap-1">
        <Suspense fallback={null}>
          <NewSessionItem />
          <ProjectsItem />
          <FilesItem />
          <FleetItem />
          <AgentTeamsItem open={teamsOpen} onToggle={toggleTeams} />
        </Suspense>
      </div>

      <Suspense fallback={null}>
        <SidebarRecents teamsOpen={teamsOpen} />
      </Suspense>

      <AccountChip />
    </div>
  );
}
