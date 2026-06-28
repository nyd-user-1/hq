"use client";

import { useSearchParams } from "next/navigation";
import Boundary from "@/app/ui/boundary";
import SidebarToggle from "@/app/ui/sidebar-toggle";
import ProjectView from "@/app/ui/project-view";

// The Projects browser as a full-width CENTER overlay (mirrors files-overlay). When
// ?center=project is set it covers the terminal column — the terminal stays mounted
// + live underneath — giving the sessions table room. Dropping the param (or
// opening a session) reveals the terminal untouched. Behind a Suspense in shell.tsx.
export default function ProjectOverlay() {
  const center = useSearchParams().get("center");
  if (center !== "project") return null;
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-zinc-950">
      <Boundary label="project-view.tsx" lead={<SidebarToggle />}>
        <ProjectView />
      </Boundary>
    </div>
  );
}
