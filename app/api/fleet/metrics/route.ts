import { NextResponse } from "next/server";
import { fleetMetrics } from "@/lib/fleet";

export const dynamic = "force-dynamic";

// GET /api/fleet/metrics                    → fleet grain, the default metric set
// GET /api/fleet/metrics?session=ID         → session grain (one transcript)
// GET /api/fleet/metrics?ids=a,b,c          → only those placed metrics
// Returns { scope, items, catalog }. The catalog feeds the kpi-panel library; the
// items feed the board. Polled ~8s; re-fetched immediately on a scope/placed change.
export function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const project = u.get("project");
  const sessionsParam = u.get("sessions") || u.get("session"); // accept the legacy singular
  const sessions = sessionsParam ? sessionsParam.split(",").filter(Boolean) : undefined;
  const idsParam = u.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : undefined;
  return NextResponse.json(fleetMetrics({ project: project || null, sessions, ids }));
}
