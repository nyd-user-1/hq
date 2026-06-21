import { NextResponse } from "next/server";
import {
  timelineFor,
  workingStatus,
  lastTurnInterrupted,
} from "@/lib/transcript";
import { getSessions, getRecentSessions, listLaunchProjects } from "@/lib/sessions";
import { latestHandoff } from "@/lib/vault";
import { lineageFor, sessionBornAt } from "@/lib/lineage";
import { getSessionsMeta } from "@/lib/sessions-meta";

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
  // ?full=1 = scrollback: the whole transcript (cached) instead of the last-24 tail.
  const full = url.searchParams.get("full") === "1";
  const { id: resolved, items, project, contextTokens, model, lastWrite, more } =
    timelineFor(target, 24, full);
  const status = workingStatus(resolved);
  // Only meaningful when NOT working: did the last turn end on a hard interrupt?
  // Drives the terminal's red "interrupted — awaiting new direction" border.
  const interrupted = !status && lastTurnInterrupted(resolved);
  // A fresh session (only local-command records, e.g. right after /clear) gets
  // resume options: recent sessions to follow, the latest handoff memo to copy.
  // Computed only then — this route polls at 1s while a turn is in flight.
  const fresh =
    items.length > 0 && items.every((it) => it.kind === "command");
  const lineage = resolved ? lineageFor(resolved) : null;
  let resume = null;
  let predecessorCtx = 0; // the continued session's context size, for the fresh-pane line
  if (fresh || staged) {
    // The reopen rows must be real interactive sessions — getSessions() has no
    // entrypoint filter, so on its own it leaks HQ's own headless sdk-cli probe
    // stubs (the ~/.../T/hq-usage-* spawns) into the kickoff list. Intersect with
    // the cli-only set (the same source ?session self-pinning already uses) to
    // drop them. Over-fetch so the staging list can scroll through many.
    const cliIds = new Set(getRecentSessions(60).map((s) => s.id));
    const recent = getSessions(60).filter((s) => cliIds.has(s.id));
    predecessorCtx =
      recent.find((s) => s.id === lineage?.predecessor?.id)?.contextTokens ?? 0;
    resume = {
      handoff: staged ? null : latestHandoff(),
      sessions: recent
        .filter((s) => staged || s.id !== resolved)
        .slice(0, staged ? 40 : 3)
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
    interrupted,
    contextTokens,
    model,
    lastWrite,
    more,
    resume,
    lineage,
    predecessorCtx,
    // The "+" staging view offers these as `cd ~/code/<p> && claude` chips.
    projects: staged ? listLaunchProjects() : undefined,
    bornAt: resolved ? sessionBornAt(resolved) : 0,
    // HQ rename (sessions-meta sidecar) → the terminal header shows it instead
    // of the abbreviated id, matching the Recents sidebar's display.
    customTitle: resolved ? getSessionsMeta()[resolved]?.title ?? "" : "",
  });
}
