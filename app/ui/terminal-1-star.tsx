"use client";

import { useSearchParams } from "next/navigation";

// Lead marker — a star in Terminal 1's top-right corner, sitting where the wall
// panes (T2-T4) carry their X close chip. BOUND TO THE LEAD SESSION, not the
// slot: it shows only when this pane actually holds the team's lead (?session ===
// ?lead), so exactly one lead marker rides the lead pane. In a team there is
// always exactly one lead, locked to slot 1 (reorderPanes refuses to move it), so
// in practice the star lives in T1 — but the binding is to the id, not the slot.
// Only shown with a wall present (2+ terminals), where telling panes apart matters.
export default function Terminal1Star() {
  const params = useSearchParams();
  const lead = params.get("lead");
  if (!lead || !params.get("wall") || params.get("session") !== lead) return null;
  return (
    <span
      title="lead · the team anchor (drivable)"
      className="absolute -top-2.5 right-3 z-20 flex shrink-0 items-center bg-zinc-800 px-1.5 py-0.5 text-amber-400"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </span>
  );
}
