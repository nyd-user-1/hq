import Boundary from "@/app/ui/boundary";
import SweepPanel from "@/app/ui/sweep-panel";
import { sweepCandidates, SWEEP_THRESHOLD_DAYS } from "@/lib/sweep";

export const dynamic = "force-dynamic";

// Sweep or Keep — the 30-day decision, moved out of Claude Code's silent cron
// and into your hands. Claude Code's own cleanupPeriodDays is pinned to 3650
// (~/.claude/settings.json), so nothing is deleted unless you say so here.
export default function Sweep() {
  return (
    <Boundary topOnly bleedX label="@panel/sweep/page.tsx">
      <SweepPanel
        initial={sweepCandidates()}
        thresholdDays={SWEEP_THRESHOLD_DAYS}
      />
    </Boundary>
  );
}
