"use client";

import { useSearchParams } from "next/navigation";
import Boundary from "@/app/ui/boundary";
import SidebarToggle from "@/app/ui/sidebar-toggle";
import FilesView from "@/app/ui/files-view";

// The Files browser as a full-width CENTER overlay. When ?center=files is set it
// covers the terminal column (the terminal stays mounted + live underneath — no
// remount), giving the Finder the room a 6-column table wants. Dropping the param
// reveals the terminal exactly as it was. Mounted in shell.tsx inside the (now
// `relative`) center column, behind a Suspense boundary (useSearchParams).
export default function FilesOverlay() {
  const center = useSearchParams().get("center");
  if (center !== "files") return null;
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-zinc-950">
      <Boundary label="files-view.tsx" lead={<SidebarToggle />}>
        <FilesView />
      </Boundary>
    </div>
  );
}
