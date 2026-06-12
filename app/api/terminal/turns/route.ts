import { NextResponse } from "next/server";
import { turnsFor, workingStatus } from "@/lib/transcript";

export const dynamic = "force-dynamic";

// Backfill + live status for the terminal island: the last N turns of a session
// (or the newest when no id), plus whether it's mid-turn right now (and what
// it's doing). Keeps node:fs server-side.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  const { id: resolved, turns, project } = turnsFor(id, 12);
  const status = workingStatus(resolved);
  return NextResponse.json({ id: resolved, turns, project, status });
}
