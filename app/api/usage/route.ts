import { NextResponse } from "next/server";
import { getUsageStates } from "@/lib/usage";

export const dynamic = "force-dynamic";

// The /usage panel's HTTP face. GET → the full set of modeled /usage states
// (session / weekly / Opus meters + forecast + spend + breakdown) in one read,
// so the independent API panel can live-poll it like the planner does.
export function GET() {
  return NextResponse.json(getUsageStates());
}
