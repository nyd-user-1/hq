import { NextResponse } from "next/server";
import { buildPlannerView } from "@/lib/planner";
import { setPlanConfig, type PlanConfig } from "@/lib/plan-config";

export const dynamic = "force-dynamic";

// The planner's HTTP face. GET → the fully-composed view (plan + both KPIs,
// calibrated). PATCH → persist a config change (tier/seats/model/maxBatch/…)
// then return the freshly-recomputed view, so the panel updates in one round-trip.

export function GET() {
  return NextResponse.json(buildPlannerView());
}

export async function PATCH(req: Request) {
  const patch = (await req.json().catch(() => ({}))) as Partial<PlanConfig>;
  setPlanConfig(patch);
  return NextResponse.json(buildPlannerView());
}
