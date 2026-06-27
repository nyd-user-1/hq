"use client";

import { useSearchParams } from "next/navigation";
import Boundary from "@/app/ui/boundary";
import SidebarToggle from "@/app/ui/sidebar-toggle";
import FleetView from "@/app/ui/fleet-view";

// The Fleet roster as a full-width CENTER overlay (mirrors files-overlay). When
// ?center=fleet is set it covers the terminal column — the terminal stays mounted
// + live underneath (no remount); dropping the param (or clicking an agent, which
// also sets ?session) reveals it. Behind a Suspense in shell.tsx (useSearchParams).
export default function FleetOverlay() {
  const center = useSearchParams().get("center");
  if (center !== "fleet") return null;
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-zinc-950">
      <Boundary label="fleet-view.tsx" lead={<SidebarToggle />}>
        <FleetView />
      </Boundary>
    </div>
  );
}
