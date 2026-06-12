import { NextResponse } from "next/server";
import { timelineFor, workingStatus } from "@/lib/transcript";

export const dynamic = "force-dynamic";

// Backfill + live status for the terminal island: the timeline (text turns +
// tool steps, interleaved) for a session (or the newest when no id), plus
// whether it's mid-turn right now and what it's doing. Keeps node:fs server-side.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  const { id: resolved, items, project, contextTokens, lastWrite } =
    timelineFor(id, 24);
  const status = workingStatus(resolved);
  return NextResponse.json({
    id: resolved,
    items,
    project,
    status,
    contextTokens,
    lastWrite,
  });
}
