import { NextResponse } from "next/server";
import {
  timelineFor,
  workingStatus,
  lastTurnInterrupted,
  detectRivalBranch,
} from "@/lib/transcript";
import { getSessions, getRecentSessions, listLaunchProjects, sessionSurface, isLiveTerminal } from "@/lib/sessions";
import { latestHandoff } from "@/lib/vault";
import { lineageFor, sessionBornAt } from "@/lib/lineage";
import { getSessionsMeta } from "@/lib/sessions-meta";
import { handoffsFor } from "@/lib/handoffs"; // HQ↔terminal control-transfer markers (NOT vault's latestHandoff above)
import { channelFor } from "@/lib/channel"; // channel-in: is a live push-channel open for this session?
import { isChannelEnabled } from "@/lib/channel-mode"; // the explicit experimental-path toggle (default OFF = MVP)
import { listRepls } from "@/lib/repl"; // the daemon's warm pool — durable "hq owns this session" truth
import { stoppedAt } from "@/lib/stops"; // "stopped from hq" marker (a killed turn writes no result)
import { tmuxLeadTeamId } from "@/lib/team-tmux"; // is this session a tmux-team LEAD? → drive via send-keys, not a fork

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
  // A hq stop SIGTERMs the turn without a closing `result`, so workingStatus() would
  // read it as "working" forever (the box re-locks on reload). If we recorded a stop
  // (lib/stops.ts) at or after the last transcript write, the turn is finished —
  // force idle here. A later real write makes the marker stale (stopAt < lastWrite),
  // so this self-clears on the next send.
  const rawStatus = workingStatus(resolved);
  const stopAt = resolved ? stoppedAt(resolved) : 0;
  const wasStopped = stopAt > 0 && stopAt >= lastWrite;
  const status = wasStopped ? null : rawStatus;
  // channel-in: a live push-channel (~/.claude/hq/channels/<resolved>.json) means
  // this session can be DRIVEN BY PUSH (no --resume fork) even while busy. Keyed on
  // `resolved` — the post-self-pin transcript id the client renders + compares — so
  // discovery filename, channelFor() lookup, and the client's send target all align.
  // channelFor is a cheap single-file fs read; fine on this 1s poll.
  //
  // GATED on the explicit channel-mode toggle (default OFF). When OFF, this is ALWAYS
  // false — even if a stale discovery file exists — so the send box can never silently
  // route through the channel path. OFF = the proven warm-REPL MVP, guaranteed.
  // `channelMode` (the global toggle) is surfaced separately so the header can show
  // the experimental-mode flask regardless of whether THIS session is channel-aware.
  const channelMode = isChannelEnabled();
  const channelConnected = channelMode && !!(resolved && channelFor(resolved));
  // Fork affordance: where did THIS session's last activity happen, and would the
  // next send fork a LIVE Claude Code terminal? `liveTerminal` gates the (neutral)
  // confirm in the send box; a cold resume just proceeds + drops a plain divider.
  const surface = resolved ? sessionSurface(resolved) : "cc";
  const liveTerminal = !!resolved && isLiveTerminal(resolved);
  // Durable hq-ownership: does the daemon hold a warm REPL for THIS session right
  // now, and is it mid-turn? This is the source of truth for "hq can drive + stop
  // this session" — unlike the client's per-instance `live`/`sending` flags, it
  // survives a reload/remount. Without it, an hq-started session whose component
  // re-mounted falls back to `locked` (no stop button, "locked while active") even
  // though hq's warm process is right there, runnable and killable. listRepls() is
  // non-spawning (returns [] with no daemon) and a cheap local-socket call.
  const agents = resolved ? await listRepls() : [];
  const owned = agents.find((a) => a.sessionId === resolved || a.key === resolved);
  const hqOwned = !!owned;
  const hqBusy = !!owned?.busy;
  // Only meaningful when NOT working: did the last turn end on a hard interrupt?
  // Drives the terminal's red "interrupted — awaiting new direction" border.
  const interrupted = !status && (wasStopped || lastTurnInterrupted(resolved));
  // If this session is the LEAD of a tmux-mode team, hq drives it by typing into
  // its tmux pane (send-keys) — NOT a warm `--resume` (which would fork the live
  // interactive lead). The terminal's send box reads this and routes accordingly.
  const tmuxLeadTeam = resolved ? tmuxLeadTeamId(resolved) : null;
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
        .map(({ id, project, lastActive, snippet, contextTokens, active, live, surface }) => ({
          id,
          project,
          lastActive,
          snippet,
          contextTokens,
          active, // cache-warm → calm green dot
          live, // connected channel → pulsing green dot
          surface, // "hq" | "cc" — where the last activity happened (Last Surface column)
        })),
    };
  }
  return NextResponse.json({
    id: resolved,
    items: timeline, // transcript items + merged handoff markers (chronological)
    project,
    status,
    channelConnected, // channel-in: push-drivable (fork-free) even while working
    channelMode, // experimental channel toggle is ON globally (drives the header flask)
    surface, // "hq" | "cc" — last activity surface for the resolved session
    liveTerminal, // resuming would fork a live CC terminal → show the neutral confirm
    hqOwned, // the daemon holds a warm REPL for this session → hq can drive + stop it (never "locked")
    hqBusy, // that warm REPL is mid-turn right now → show the stop button even after a remount
    interrupted,
    tmuxLeadTeam, // teamId when this session is a tmux-team lead → send box uses send-keys

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
