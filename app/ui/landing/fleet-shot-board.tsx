"use client";

import type { MetricItem } from "@/lib/fleet";
import { KpiTile, ShapeCard } from "@/app/ui/fleet-view";

// The fixed board layout for the landing hero — the preferred Analytics view,
// laid out like the real fleet board but without FleetGrid's drag/resize/persist
// machinery (this is a product shot, not a workspace). Cells are the REAL
// KpiTile/ShapeCard components, so tooltips, the range picker, and the rAF
// path-morph all work. Heights are explicit because the cards fill their parent.
export default function FleetShotBoard({ items }: { items: MetricItem[] }) {
  const by = new Map(items.map((it) => [it.id, it]));
  const stat = (id: string) => {
    const it = by.get(id);
    return it?.stat ? <KpiTile k={it.stat} /> : null;
  };
  const shape = (id: string) => {
    const it = by.get(id);
    return it?.shape ? <ShapeCard shape={it.shape} /> : null;
  };
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-3 gap-3 lg:grid-cols-6" style={{ height: 76 }}>
        {stat("f_sessions")}
        {stat("f_tokens")}
        {stat("f_turns")}
        {stat("f_projects")}
        {stat("todos_pending")}
        {stat("f_cliff")}
      </div>
      <div style={{ height: 300 }}>{shape("tokens_by_session_area")}</div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" style={{ height: 280 }}>
        {shape("tokens_day_area")}
        {shape("tokens_stacked_area")}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" style={{ height: 224 }}>
        {shape("tokens_by_project")}
        {shape("tokens_per_session")}
      </div>
    </div>
  );
}
