import { NextResponse } from "next/server";
import { timelineFor, workingStatus } from "@/lib/transcript";
import { getSessions, getRecentSessions, listCodeProjects } from "@/lib/sessions";
import { latestHandoff } from "@/lib/vault";
import { lineageFor, sessionBornAt } from "@/lib/lineage";

export const dynamic = "force-dynamic";

// Backfill + live status for the terminal island: the timeline (text turns +
// tool steps, interleaved) for a session (or the newest when no id), plus
// whether it's mid-turn right now and what it's doing. Keeps node:fs server-side.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("session");
  const exclude = url.searchParams.get("exclude");
  // The staged "+" view: no session of its own — it follows the newest (for
  // newborn detection) and always gets the recent-sessions list, but never
  // the handoff kickoff (that belongs to /clear-born continuations).
  const staged = url.searchParams.get("staged") === "1";
  // No explicit session (and not staging): resolve the newest INTERACTIVE
  // session, skipping the one Terminal 2 is showing (?exclude). This is what the
  // unpinned terminal pins itself to — so it never lands on Terminal 2's session
  // or on an ephemeral SDK run (getRecentSessions is already cli-only).
  let target = id;
  if (!id && !staged) {
    target = getRecentSessions(5).find((s) => s.id !== exclude)?.id ?? null;
  }
  const { id: resolved, items, project, contextTokens, lastWrite } =
    timelineFor(target, 24);
  const status = workingStatus(resolved);
  // A fresh session (only local-command records, e.g. right after /clear) gets
  // resume options: recent sessions to follow, the latest handoff memo to copy.
  // Computed only then — this route polls at 1s while a turn is in flight.
  const fresh =
    items.length > 0 && items.every((it) => it.kind === "command");
  const lineage = resolved ? lineageFor(resolved) : null;
  let resume = null;
  let predecessorCtx = 0; // the continued session's context size, for the fresh-pane line
  if (fresh || staged) {
    const recent = getSessions(8);
    predecessorCtx =
      recent.find((s) => s.id === lineage?.predecessor?.id)?.contextTokens ?? 0;
    resume = {
      handoff: staged ? null : latestHandoff(),
      sessions: recent
        .filter((s) => staged || s.id !== resolved)
        .slice(0, 3)
        .map(({ id, project, lastActive, snippet, contextTokens }) => ({
          id,
          project,
          lastActive,
          snippet,
          contextTokens,
        })),
    };
  }
  return NextResponse.json({
    id: resolved,
    items,
    project,
    status,
    contextTokens,
    lastWrite,
    resume,
    lineage,
    predecessorCtx,
    // The "+" staging view offers these as `cd ~/code/<p> && claude` chips.
    projects: staged ? listCodeProjects() : undefined,
    bornAt: resolved ? sessionBornAt(resolved) : 0,
  });
}
