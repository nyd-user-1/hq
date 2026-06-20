import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HQ's durable SESSION-EVENT SINK. Claude Code hooks (SessionStart / SessionEnd)
// POST their raw JSON to /api/events, which normalizes and appends one NDJSON line
// here. Unlike lib/session-status.ts — which reads the CLI's LIVE per-pid record
// (truth for "is this running right now") — this is the append-only HISTORY: a
// durable timeline of when each session started/ended and why. The live record
// vanishes when the process exits; these events persist. Pure node:fs; tolerates a
// missing/empty file (everything returns []).
//
// Hook registration is OPT-IN — HQ never writes your settings.json. See
// scripts/hooks/session-events.mjs for the snippet, or the /install page.

const HQ_DIR = path.join(os.homedir(), ".claude", "hq");
const LOG = path.join(HQ_DIR, "events.ndjson");

// The events we normalize + persist. Other hook events POSTed here are rejected by
// the route (it validates hook_event_name) so the log stays a clean session ledger.
export type EventKind = "SessionStart" | "SessionEnd";

export const KNOWN_KINDS: readonly EventKind[] = ["SessionStart", "SessionEnd"];

export function isKnownKind(k: unknown): k is EventKind {
  return typeof k === "string" && (KNOWN_KINDS as readonly string[]).includes(k);
}

// A normalized, stored event. `reason` holds SessionStart's `source`
// (startup|resume|clear|compact) OR SessionEnd's `reason`
// (clear|resume|logout|prompt_input_exit|bypass_permissions_disabled|other).
export type SessionEvent = {
  id: string; // unique line id
  at: string; // ISO timestamp HQ stamped on receipt
  kind: EventKind;
  sessionId: string;
  cwd: string;
  reason: string; // source (start) | reason (end) — "" when absent
};

// The raw Claude Code hook body (the fields we read; tolerant of the rest).
export type HookPayload = {
  hook_event_name?: unknown;
  session_id?: unknown;
  cwd?: unknown;
  source?: unknown; // SessionStart
  reason?: unknown; // SessionEnd
  [k: string]: unknown;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// Normalize an incoming hook payload to a SessionEvent and APPEND one NDJSON line
// (fs.appendFileSync is atomic for the small lines we write — the OS does one
// O_APPEND write, so concurrent hooks interleave whole lines, never tear one).
// Returns the stored event, or null on a malformed/unknown payload (never throws).
export function recordEvent(payload: HookPayload): SessionEvent | null {
  const kind = payload?.hook_event_name;
  if (!isKnownKind(kind)) return null;

  const ev: SessionEvent = {
    id: `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    kind,
    sessionId: str(payload.session_id),
    cwd: str(payload.cwd),
    // SessionStart carries `source`; SessionEnd carries `reason`. Prefer whichever
    // the event defines, falling back to the other so neither is ever lost.
    reason:
      kind === "SessionStart"
        ? str(payload.source) || str(payload.reason)
        : str(payload.reason) || str(payload.source),
  };

  try {
    fs.mkdirSync(HQ_DIR, { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify(ev) + "\n");
  } catch {
    // best-effort — the sink is fire-and-forget; a write failure must not throw
    return null;
  }
  return ev;
}

// ── incremental, offset-cached read (modeled on lib/calls.ts) ─────────────────
// The log only ever grows, so we parse it once and on each later read only the
// newly-appended bytes — the same byte-offset trick the token meter / Calls ledger
// use. Kept in-process (no sidecar needed: the file IS the durable store, and a
// re-parse from offset 0 after a restart is cheap for a session-grained log).
let cachedOffset = 0;
let cachedEvents: SessionEvent[] = [];

function refresh(): void {
  let size: number;
  try {
    size = fs.statSync(LOG).size;
  } catch {
    // no file yet — nothing recorded
    cachedOffset = 0;
    cachedEvents = [];
    return;
  }
  if (size < cachedOffset) {
    // truncated/rotated out from under us — re-read from the top
    cachedOffset = 0;
    cachedEvents = [];
  }
  if (size === cachedOffset) return;

  let buf: Buffer;
  try {
    const fd = fs.openSync(LOG, "r");
    buf = Buffer.alloc(size - cachedOffset);
    fs.readSync(fd, buf, 0, buf.length, cachedOffset);
    fs.closeSync(fd);
  } catch {
    return;
  }

  const text = buf.toString("utf8");
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline === -1) return; // only a partial trailing line so far
  cachedOffset += Buffer.byteLength(text.slice(0, lastNewline + 1), "utf8");

  for (const line of text.slice(0, lastNewline).split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line) as SessionEvent;
      if (isKnownKind(e?.kind) && typeof e?.at === "string") cachedEvents.push(e);
    } catch {
      // skip a malformed line, keep the rest
    }
  }
}

// Recent events, NEWEST first. `since` keeps only events at/after an ISO instant;
// `session` filters to one session id.
export function readEvents(opts: { since?: string; session?: string } = {}): SessionEvent[] {
  refresh();
  let out = cachedEvents;
  if (opts.session) out = out.filter((e) => e.sessionId === opts.session);
  if (opts.since) {
    const floor = opts.since;
    out = out.filter((e) => e.at >= floor);
  }
  // copy before sort so we never mutate the cache's order
  return [...out].sort((a, b) => b.at.localeCompare(a.at));
}

// One session's lifespan, folded from its events.
export type SessionSpan = {
  sessionId: string;
  startedAt: string | null; // first SessionStart `at`
  endedAt: string | null; // last SessionEnd `at`, or null if still open
  cwd: string;
  startReason: string; // startup | resume | clear | compact
  endReason: string; // SessionEnd reason, or "" while open
};

// Fold SessionStart/SessionEnd pairs into per-session spans. A session can restart
// (resume after end); we keep the EARLIEST start and the LATEST end so the span
// covers the full observed lifetime. Newest-started first.
export function sessionSpans(): SessionSpan[] {
  refresh();
  const byId = new Map<string, SessionSpan>();
  // walk oldest→newest so first/last fall out naturally
  const chrono = [...cachedEvents].sort((a, b) => a.at.localeCompare(b.at));
  for (const e of chrono) {
    if (!e.sessionId) continue;
    let span = byId.get(e.sessionId);
    if (!span) {
      span = {
        sessionId: e.sessionId,
        startedAt: null,
        endedAt: null,
        cwd: e.cwd,
        startReason: "",
        endReason: "",
      };
      byId.set(e.sessionId, span);
    }
    if (e.cwd) span.cwd = e.cwd;
    if (e.kind === "SessionStart") {
      if (!span.startedAt) {
        span.startedAt = e.at;
        span.startReason = e.reason;
      }
    } else {
      span.endedAt = e.at; // latest end wins
      span.endReason = e.reason;
    }
  }
  return [...byId.values()].sort((a, b) =>
    (b.startedAt ?? "").localeCompare(a.startedAt ?? "")
  );
}
