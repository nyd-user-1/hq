import Boundary from "@/app/ui/boundary";
import RoutinePanel, { type RoutineGroup } from "@/app/ui/routine-panel";
import { getRoutines, CADENCE_ORDER, CADENCE_BLURB } from "@/lib/routines";

export const dynamic = "force-dynamic";

// Routines = operator routines by cadence (on-demand · local · cloud · agent),
// read live from the vault. Grouping happens here (server) so the client panel
// stays free of lib/routines' node:fs. on-demand fires now; rest → /schedule.
export default function Routines() {
  const routines = getRoutines();
  const groups: RoutineGroup[] = CADENCE_ORDER.map((c) => ({
    cadence: c,
    blurb: CADENCE_BLURB[c],
    items: routines.filter((r) => r.cadence === c),
  })).filter((g) => g.items.length > 0);

  return (
    <Boundary label="@panel/routines/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
        <RoutinePanel groups={groups} />
      </div>
      <p className="font-mono text-[11px] text-zinc-600">
        reads !hq/*launchpad/004 Routines.md live
      </p>
    </Boundary>
  );
}
