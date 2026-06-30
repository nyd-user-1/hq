"use client";

import { useSearchParams } from "next/navigation";

// Lead / anchor marker — a star in Terminal 1's top-right corner, sitting where
// the wall panes (T2-T4) carry their X close chip. Slot 1 is the ?session anchor
// — in a team that's the LEAD — so the star lets you always spot the lead pane,
// even after dragging panes around (reorder promotes a pane INTO slot 1, and the
// star marks whichever pane holds the anchor). Only shown with a wall present
// (2+ terminals), where telling panes apart actually matters.
export default function Terminal1Star() {
  const params = useSearchParams();
  if (!params.get("wall")) return null;
  return (
    <span
      title="lead · the anchor terminal (slot 1)"
      className="absolute -top-2.5 right-3 z-20 flex shrink-0 items-center bg-zinc-800 px-1.5 py-0.5 text-amber-400"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </span>
  );
}
