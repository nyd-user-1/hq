"use client";

import { Suspense } from "react";
import Link from "next/link";
import NewSessionItem from "@/app/ui/new-session-item";
import ProjectsItem from "@/app/ui/projects-item";
import FilesItem from "@/app/ui/files-item";
import FleetItem from "@/app/ui/fleet-item";
import SidebarRecents from "@/app/ui/sidebar-recents";
import AccountChip from "@/app/ui/account-chip";

// Left rail. Brand → "/" (closes the panel, terminal-only focus). "New Session"
// is the primary action (Search moved to the terminal boundary's search icon).
// The panel groups (Activity/Metrics/Console) live in the terminal's "panels"
// dropdown, so the sidebar is just New Session + Recent Sessions (Claude-style).
export default function Sidebar() {
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Brand chip — same thin border / resting-bg / hover as the account chip
          at the foot of the rail; px-2.5 lines "hq/terminal" up with the item
          icons below it. */}
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
        </Suspense>
      </div>

      <Suspense fallback={null}>
        <SidebarRecents />
      </Suspense>

      <AccountChip />
    </div>
  );
}
