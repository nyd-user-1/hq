"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useFocus } from "@/app/ui/focus-state";
import type { WallView } from "@/app/ui/terminals";
import FleetView from "@/app/ui/fleet-view";
import FilesView from "@/app/ui/files-view";
import ProjectView from "@/app/ui/project-view";

// A dashboard view rendered as a terminal's content. Fleet is a clean drop-in (no
// props, no searchParams, h-full self-scroll); Files/Projects render fine but still
// carry their ?center-overlay router wiring (minor quirks in a pane).
function ViewFor({ view }: { view: WallView }) {
  if (view === "fleet") return <FleetView />;
  if (view === "files") return <FilesView />;
  if (view === "projects") return <ProjectView />;
  return null; // "sessions" home isn't embeddable in a pane yet
}

// A view pane carries the same focus behavior as a session pane (Terminal does its
// own): a pointer-down makes it active, and it wears the blue .is-active border —
// but only with 2+ terminals on screen (a lone terminal is trivially active, so
// blue then is noise). Works for both a wall pane and Terminal 1 hosting a view.
export default function PaneView({
  view,
  terminalKey,
}: {
  view: WallView;
  terminalKey: string;
}) {
  const { activeKey, setActive } = useFocus();
  const wall = useSearchParams().get("wall");
  const ref = useRef<HTMLDivElement>(null);
  // Wall panes (t2..t4) only exist when the wall is non-empty → always multi. T1 is
  // multi only when the wall has panes.
  const multiTerminal = terminalKey !== "t1" || !!wall;
  const isActive = activeKey === terminalKey && multiTerminal;
  useEffect(() => {
    const box = ref.current?.closest(".boundary-flash");
    if (!box) return;
    box.classList.toggle("is-active", isActive);
    return () => box.classList.remove("is-active");
  }, [isActive]);
  return (
    <div
      ref={ref}
      onPointerDownCapture={() => setActive(terminalKey)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ViewFor view={view} />
    </div>
  );
}
