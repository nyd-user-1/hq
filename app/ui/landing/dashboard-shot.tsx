"use client";

import { useEffect, useState } from "react";
import type { MetricItem } from "@/lib/fleet";
import DashboardBoard from "./dashboard-board";

// The landing's analytics dashboard — the REAL Analytics board, fetched from the
// same /api/fleet/metrics the live view polls, rendered by the real ShapeCard
// components. Not a mockup: live numbers off disk, refreshed on the view's own 8s
// cadence. (Client-fetched because the landing mounts inside the client
// Terminal1Slot — the reader's node:fs can't cross that boundary.) The metric set
// mirrors the preferred board: six stat cards + the three temporal areas.
const IDS = [
  "f_sessions",
  "f_tokens",
  "f_turns",
  "f_projects",
  "todos_pending",
  "f_cliff",
  "tokens_by_session_area",
  "tokens_day_area",
  "tokens_stacked_area",
].join(",");

export default function DashboardShot() {
  const [items, setItems] = useState<MetricItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/fleet/metrics?ids=${IDS}`)
        .then((r) => r.json())
        .then((d) => {
          if (alive && Array.isArray(d?.items)) setItems(d.items);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!items) return <div aria-hidden className="h-full" />;
  return <DashboardBoard items={items} />;
}
