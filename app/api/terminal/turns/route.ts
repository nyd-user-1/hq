import { NextResponse } from "next/server";
import { timelineFor, workingStatus } from "@/lib/transcript";
import { getSessions } from "@/lib/sessions";
import { latestHandoff } from "@/lib/vault";

export const dynamic = "force-dynamic";

// Backfill + live status for the terminal island: the timeline (text turns +
// tool steps, interleaved) for a session (or the newest when no id), plus
// whether it's mid-turn right now and what it's doing. Keeps node:fs server-side.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  const { id: resolved, items, project, contextTokens, lastWrite } =
    timelineFor(id, 24);
  const status = workingStatus(resolved);
  // A fresh session (only local-command records, e.g. right after /clear) gets
  // resume options: recent sessions to follow, the latest handoff memo to copy.
  // Computed only then — this route polls at 1s while a turn is in flight.
  const fresh =
    items.length > 0 && items.every((it) => it.kind === "command");
  const resume = fresh
    ? {
        handoff: latestHandoff(),
        sessions: getSessions(8)
          .filter((s) => s.id !== resolved)
          .slice(0, 3)
          .map(({ id, project, lastActive, snippet }) => ({
            id,
            project,
            lastActive,
            snippet,
          })),
      }
    : null;
  return NextResponse.json({
    id: resolved,
    items,
    project,
    status,
    contextTokens,
    lastWrite,
    resume,
  });
}
