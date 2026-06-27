import { NextResponse } from "next/server";
import { fleetMetrics } from "@/lib/fleet";

export const dynamic = "force-dynamic";

// GET /api/fleet/metrics            → fleet-grain dashboard (all sessions)
// GET /api/fleet/metrics?session=ID → session-grain (one transcript)
// The "monitor" feed for the Fleet deck's canvas; the live roster + runway come
// from /api/terminal/repl/list. Polled slower than the roster (~8s) since it
// aggregates; re-fetched immediately on a scope change.
export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  return NextResponse.json(fleetMetrics(id || null));
}
