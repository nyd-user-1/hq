import { NextResponse } from "next/server";
import {
  timelineFor,
  workingStatus,
  lastTurnInterrupted,
  detectRivalBranch,
} from "@/lib/transcript";
import { getSessions, getRecentSessions, listLaunchProjects } from "@/lib/sessions";
import { latestHandoff } from "@/lib/vault";
import { lineageFor, sessionBornAt } from "@/lib/lineage";
import { getSessionsMeta } from "@/lib/sessions-meta";
import { handoffsFor } from "@/lib/handoffs"; // HQ↔terminal control-transfer markers (NOT vault's latestHandoff above)
import { channelFor } from "@/lib/channel"; // channel-in: is a live push-channel open for this session?

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
  // Merge HQ↔terminal handoff markers (sidecar) into the timeline by `at`. The
  // sidecar is the ONLY source — HQ never writes these into the .jsonl. When NOT
  // full, `items` is a tail, so floor markers at the tail's first `at` (older ones
  // belong to scrollback, surfaced when full=1). resolved-only (staged has none).
  // IMPORTANT: `items` is a CACHED array reference (timelineFor returns the same
  // array it memoizes) — build a NEW array; never push/sort it in place, or the
  // cache is corrupted and markers re-duplicate on every poll.
  let timeline = items;
  if (resolved) {
    const floor = full ? "" : (items[0]?.at ?? "");
    const marks = handoffsFor(resolved)
      .filter((h) => h.at >= floor)
      .map((h) => ({ kind: "handoff" as const, direction: h.direction, at: h.at }));
    if (marks.length) {
      timeline = [...items, ...marks].sort((a, b) =>
        a.at < b.at ? -1 : a.at > b.at ? 1 : 0, // ISO `at` ⇒ chronological
      );
    }
  }
  const status = workingStatus(resolved);
  // channel-in: a live push-channel (~/.claude/hq/channels/<resolved>.json) means
  // this session can be DRIVEN BY PUSH (no --resume fork) even while busy. Keyed on
  // `resolved` — the post-self-pin transcript id the client renders + compares — so
  // discovery filename, channelFor() lookup, and the client's send target all align.
  // channelFor is a cheap single-file fs read; fine on this 1s poll.
  const channelConnected = !!(resolved && channelFor(resolved));
  // Only meaningful when NOT working: did the last turn end on a hard interrupt?
  // Drives the terminal's red "interrupted — awaiting new direction" border.
  const interrupted = !status && lastTurnInterrupted(resolved);
  // Divergence net: did a rival (still-open TUI) process write a divergent leaf
  // into the same transcript HQ's warm repl is driving? Transcript-derived
  // knownLeaf — no extra input. Rides this 1s poll; no new endpoint.
  const rival = detectRivalBranch(resolved);
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
    items: timeline, // transcript items + merged handoff markers (chronological)
    project,
    status,
    channelConnected, // channel-in: push-drivable (fork-free) even while working
    interrupted,
    diverged: rival.diverged,
    rivalLeafUuid: rival.rivalLeafUuid,
    rivalPreview: rival.rivalPreview,
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
