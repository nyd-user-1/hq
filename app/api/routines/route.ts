import { getRoutines, CADENCE_ORDER, CADENCE_BLURB } from "@/lib/routines";
import type { RoutineGroup } from "@/app/ui/routine-panel";

// Reads the vault file on disk (!hq/*launchpad/004 Routines.md) — never cache.
export const dynamic = "force-dynamic";

// GET — operator routines grouped by cadence (on-demand · local · cloud · agent).
// Grouping happens here (server) so the client panel never pulls lib/routines'
// node:fs into the browser bundle — same split the @panel/routines page used.
export async function GET() {
  const routines = getRoutines();
  const groups: RoutineGroup[] = CADENCE_ORDER.map((c) => ({
    cadence: c,
    blurb: CADENCE_BLURB[c],
    items: routines.filter((r) => r.cadence === c),
  })).filter((g) => g.items.length > 0);
  return Response.json({ groups });
}
