import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HQ's durable HOOK-EVENT SINK — the real-time data layer. Claude Code hooks POST
// their raw JSON to /api/events, which normalizes and appends one NDJSON line here.
// Unlike lib/session-status.ts — which reads the CLI's LIVE per-pid record (truth
// for "is this running right now") — this is the append-only HISTORY: a durable,
// event-driven timeline of what each session DID (turns, subagent fan-out, tasks,
// compactions, teammate state, clean/failed stops). The live record vanishes when
// the process exits; these events persist. Pure node:fs; tolerates a missing file.
//
// We capture the LOW-VOLUME STATE TRANSITIONS — the events a polling reader can't
// cheaply reconstruct from the transcript — and deliberately SKIP the firehose
// (PostToolUse fires per tool call; MessageDisplay is display-only). Each event is
// an envelope { id, at, kind, sessionId, cwd, transcriptPath } plus a per-kind
// `data` blob; large fields (compact_summary, prompts, messages) are CLIPPED so a
// single line stays well under the 4KB POSIX atomic-append bound.
//
// Hook registration is OPT-IN — HQ never writes your settings.json. SessionStart
// can't be an http hook (command bridge: scripts/hooks/session-events.mjs); every
// other event below is a native type:"http" hook → /api/events. See the /cmd snippet.

const HQ_DIR = path.join(os.homedir(), ".claude", "hq");
const LOG = path.join(HQ_DIR, "events.ndjson");
// Clip any stored string field — protects line size AND append atomicity (POSIX
// only guarantees a torn-free O_APPEND under PIPE_BUF, 4KB; a PostCompact summary
// or a long prompt would otherwise blow past it and let parallel hooks interleave).
const CLIP = 1200;

// The hook events HQ normalizes + persists. Anything else POSTed here is rejected
// by the route (it validates hook_event_name) so the log stays a clean signal feed.
export type EventKind =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit" // turn START (bookends Stop)
  | "Stop" // turn END, clean
  | "StopFailure" // turn END on a rate-limit/billing/overload wall — the ONLY death signal
  | "SubagentStart" // parallel-agent fan-OUT
  | "SubagentStop" // …fan-IN (carries the subagent's result + transcript path)
  | "TaskCreated"
  | "TaskCompleted"
  | "TeammateIdle"
  | "PreCompact"
  | "PostCompact" // carries the compact_summary HQ can durably keep
  | "CwdChanged"
  | "Notification"; // permission prompts etc. (pairs with the future channels relay)

export const KNOWN_KINDS: readonly EventKind[] = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "TeammateIdle",
  "PreCompact",
  "PostCompact",
  "CwdChanged",
  "Notification",
];

export function isKnownKind(k: unknown): k is EventKind {
  return typeof k === "string" && (KNOWN_KINDS as readonly string[]).includes(k);
}

// A normalized, stored event. `reason` holds SessionStart's `source` / SessionEnd's
// `reason` (kept for back-compat with sessionSpans); the per-kind identifying fields
// (agentId, taskId, oldCwd/newCwd, error, …) live in `data`. `transcriptPath` is the
// universal join key back to HQ's transcript reader (lib/transcript.ts).
export type SessionEvent = {
  id: string; // unique line id
  at: string; // ISO timestamp HQ stamped on receipt
  kind: EventKind;
  sessionId: string;
  cwd: string;
  reason: string; // source (start) | reason (end) — "" for the other kinds
  transcriptPath?: string;
  data?: Record<string, unknown>; // per-kind fields (clipped); absent when empty
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
// Clipped string: bounds large fields (summaries/prompts/messages) — see CLIP.
const clip = (v: unknown): string => {
  const s = str(v);
  return s.length > CLIP ? s.slice(0, CLIP) + "…" : s;
};

// Pull the kind-specific identifying fields into the `data` blob. Only non-empty
// fields are kept (so the line stays small), and every string is clipped. This is
// the part the old single-`reason` shape threw away — agentId, taskId, the cwd
// pair, the failure error, the compaction summary, etc.
function extractData(kind: EventKind, p: HookPayload): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    const s = clip(v);
    if (s) d[k] = s;
  };
  // common: a hook firing inside a subagent carries these on any kind.
  put("agentId", p.agent_id);
  put("agentType", p.agent_type);
  switch (kind) {
    case "SessionStart":
      put("source", p.source);
      put("model", p.model);
      break;
    case "UserPromptSubmit":
      put("prompt", p.prompt);
      break;
    case "Stop":
      put("lastMessage", p.last_assistant_message);
      break;
    case "StopFailure":
      put("error", p.error);
      put("errorDetails", p.error_details);
      put("lastMessage", p.last_assistant_message);
      break;
    case "SubagentStop":
      put("lastMessage", p.last_assistant_message);
      put("agentTranscript", p.agent_transcript_path);
      break;
    case "TaskCreated":
    case "TaskCompleted":
      put("taskId", p.task_id);
      put("subject", p.task_subject);
      put("description", p.task_description);
      put("teammate", p.teammate_name);
      break;
    case "TeammateIdle":
      put("teammate", p.teammate_name);
      break;
    case "PreCompact":
      put("trigger", p.trigger);
      break;
    case "PostCompact":
      put("trigger", p.trigger);
      put("summary", p.compact_summary);
      break;
    case "CwdChanged":
      put("oldCwd", p.old_cwd);
      put("newCwd", p.new_cwd);
      break;
    case "Notification":
      put("message", p.message);
      put("notificationType", p.notification_type);
      break;
    // SessionEnd → reason on the envelope; SubagentStart → agentId/agentType above.
  }
  return d;
}

// Normalize an incoming hook payload to a SessionEvent and APPEND one NDJSON line
// (fs.appendFileSync = one O_APPEND write; CLIP keeps lines under PIPE_BUF so
// concurrent hooks interleave whole lines, never tear one). Returns the stored
// event, or null on a malformed/unknown payload (never throws — the sink is
// fire-and-forget; a hook firing into a half-up server must not error).
export function recordEvent(payload: HookPayload): SessionEvent | null {
  const kind = payload?.hook_event_name;
  if (!isKnownKind(kind)) return null;

  const data = extractData(kind, payload);
  const transcriptPath = clip(payload.transcript_path);
  const ev: SessionEvent = {
    id: `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    kind,
    sessionId: str(payload.session_id),
    cwd: str(payload.cwd),
    // SessionStart carries `source`; SessionEnd carries `reason`; other kinds put
    // their detail in `data`, so `reason` stays a session-lifecycle field.
    reason:
      kind === "SessionStart"
        ? str(payload.source) || str(payload.reason)
        : kind === "SessionEnd"
          ? str(payload.reason) || str(payload.source)
          : "",
    ...(transcriptPath ? { transcriptPath } : {}),
    ...(Object.keys(data).length ? { data } : {}),
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
    // Spans are session lifecycle ONLY — skip the activity kinds (else the `else`
    // branch below would read a SubagentStart/Stop etc. as a session end).
    if (e.kind !== "SessionStart" && e.kind !== "SessionEnd") continue;
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

// One subagent run, folded from its SubagentStart/SubagentStop pair. The fan-out a
// parent session spawned — without parsing the nested subagents/*.jsonl, since
// SubagentStop hands us the result + transcript path directly.
export type SubagentRun = {
  agentId: string;
  agentType: string;
  parentSession: string;
  startedAt: string | null;
  endedAt: string | null; // null = still running
  lastMessage: string; // the subagent's final message (clipped), when stopped
  transcriptPath: string; // the subagent's own transcript, when stopped
};

// Subagent runs, newest-started first. `session` filters to one parent session.
export function subagentRuns(session?: string): SubagentRun[] {
  refresh();
  const byAgent = new Map<string, SubagentRun>();
  const chrono = [...cachedEvents].sort((a, b) => a.at.localeCompare(b.at));
  for (const e of chrono) {
    if (e.kind !== "SubagentStart" && e.kind !== "SubagentStop") continue;
    const agentId = str(e.data?.agentId);
    if (!agentId) continue;
    if (session && e.sessionId !== session) continue;
    let r = byAgent.get(agentId);
    if (!r) {
      r = {
        agentId,
        agentType: str(e.data?.agentType),
        parentSession: e.sessionId,
        startedAt: null,
        endedAt: null,
        lastMessage: "",
        transcriptPath: "",
      };
      byAgent.set(agentId, r);
    }
    if (str(e.data?.agentType)) r.agentType = str(e.data?.agentType);
    if (e.kind === "SubagentStart") {
      if (!r.startedAt) r.startedAt = e.at;
    } else {
      r.endedAt = e.at;
      r.lastMessage = str(e.data?.lastMessage);
      r.transcriptPath = str(e.data?.agentTranscript);
    }
  }
  return [...byAgent.values()].sort((a, b) =>
    (b.startedAt ?? "").localeCompare(a.startedAt ?? "")
  );
}

// The newest events across ALL kinds — a live activity feed for the Firehose/
// Sessions surface. `session` filters to one session.
export function recentActivity(limit = 100, session?: string): SessionEvent[] {
  refresh();
  let out = cachedEvents;
  if (session) out = out.filter((e) => e.sessionId === session);
  return [...out].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
