"use client";

import { CHIP_CLASS } from "@/app/ui/boundary-chip";
import { usePlanner } from "@/app/ui/planner-state";

// BoundaryChip variant that toggles the independent Batch Planner panel. Sits on
// the terminal boundary trail beside PanelMenu (▾) and SearchTrigger (🔍). Unlike
// those it's pure client state — no route nav — so it can open alongside them.
export default function PlannerTrigger() {
  const { open, toggle } = usePlanner();
  return (
    <button
      title="Batch Planner — group todos into efficient, dependency-safe sessions"
      onClick={toggle}
      className={`${CHIP_CLASS} flex shrink-0 items-center gap-1 ${
        open ? "text-zinc-100" : ""
      }`}
    >
      planner
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    </button>
  );
}
