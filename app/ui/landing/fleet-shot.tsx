"use client";

import { useEffect, useState } from "react";
import type { MetricItem } from "@/lib/fleet";
import FleetShotBoard from "./fleet-shot-board";

// The hero's product shot — the REAL fleet board ("Analytics"), fetched from the
// same /api/fleet/metrics the real FleetView polls, rendered by the real
// KpiTile/ShapeCard components. Not a mockup: live numbers off disk, refreshed
// on the view's own 8s cadence. (Client-fetched because the landing mounts
// inside the client Terminal1Slot — lib/fleet's node:fs can't cross that
// boundary.) The metric set mirrors the preferred board: six stat cards, the
// three temporal areas, the two rankings.
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

export default function FleetShot() {
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
  return <FleetShotBoard items={items} />;
}
