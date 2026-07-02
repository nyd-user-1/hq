"use client";

import type { MetricItem } from "@/lib/fleet";
import { ShapeCard } from "@/app/ui/fleet-view";

// Landing-only stat tile — value-only, larger, three-across (Brendan's live
// devtools edit persisted). The real fleet view keeps the labeled KpiTile.
const TONE: Record<string, string> = {
  green: "text-green-400",
  blue: "text-blue-400",
  orange: "text-orange-400",
  amber: "text-amber-400",
  red: "text-red-400",
  zinc: "text-zinc-50",
};

function ShotStat({ value, tone }: { value: string; tone?: string }) {
  return (
    <div className="flex h-[52px] items-center rounded-lg border border-zinc-800/70 bg-zinc-900/30 px-5">
      <span className={`text-[26px] leading-none tracking-tight ${TONE[tone ?? "zinc"] ?? TONE.zinc}`}>
        {value}
      </span>
    </div>
  );
}

// The fixed board layout for the landing hero — the preferred Analytics view,
// laid out like the real fleet board but without FleetGrid's drag/resize/persist
// machinery (this is a product shot, not a workspace). Cells are the REAL
// KpiTile/ShapeCard components, so tooltips, the range picker, and the rAF
// path-morph all work. Heights are explicit because the cards fill their parent.
export default function FleetShotBoard({ items }: { items: MetricItem[] }) {
  const by = new Map(items.map((it) => [it.id, it]));
  const stat = (id: string) => {
    const it = by.get(id);
    return it?.stat ? <ShotStat value={it.stat.value} tone={it.stat.tone} /> : null;
  };
  const shape = (id: string) => {
    const it = by.get(id);
    return it?.shape ? <ShapeCard shape={it.shape} /> : null;
  };
  // Fills the frame exactly — fixed stat row, the two chart rows flex to the
  // remaining height, so the board never scrolls.
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="grid shrink-0 grid-cols-3 gap-3">
        {stat("f_sessions")}
        {stat("f_tokens")}
        {stat("f_turns")}
        {stat("f_projects")}
        {stat("todos_pending")}
        {stat("f_cliff")}
      </div>
      <div className="min-h-0 flex-[1.1]">{shape("tokens_by_session_area")}</div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        {shape("tokens_day_area")}
        {shape("tokens_stacked_area")}
      </div>
    </div>
  );
}
