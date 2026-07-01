"use client";

import { Suspense, useEffect, useState } from "react";
import QuickSearchItem from "@/app/ui/quick-search-item";
import DownloadHqItem from "@/app/ui/download-hq-item";
import NewSessionItem from "@/app/ui/new-session-item";
import FilesItem from "@/app/ui/files-item";
import ProjectsItem from "@/app/ui/projects-item";
import AnalyticsItem from "@/app/ui/analytics-item";
import AgentTeamsItem from "@/app/ui/agent-teams-item";
import SidebarRecents from "@/app/ui/sidebar-recents";
import AccountChip from "@/app/ui/account-chip";

const TEAMS_OPEN_KEY = "hq:agent-teams-open";

// Left rail. Top: a Quick-search box (opens ⌘K), then Download hq + New Session —
// the actions. An "Observe" group follows — Files · Projects (expandable list) ·
// Analytics (expandable views) · Agent Teams — over Recents, with the account chip
// ("hq/settings") pinned at the foot.
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
      {/* Quick search — opens the ⌘K command palette (the real search surface). */}
      <QuickSearchItem />

      {/* Actions — get the app, or stage a fresh session. */}
      <div className="flex shrink-0 flex-col gap-1">
        <DownloadHqItem />
        <Suspense fallback={null}>
          <NewSessionItem />
        </Suspense>
      </div>

      {/* Observe — the read surfaces. */}
      <div className="flex shrink-0 flex-col gap-1">
        <span className="px-2.5 pt-1 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          Observe
        </span>
        <Suspense fallback={null}>
          <FilesItem />
          <ProjectsItem />
          <AnalyticsItem />
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
