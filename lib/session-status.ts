import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// AUTHORITATIVE live-session status. Claude Code writes one
// ~/.claude/sessions/<pid>.json per running process with the real status the CLI
// itself tracks — { sessionId, status: "busy"|"idle", startedAt, updatedAt,
// statusUpdatedAt, ... }. HQ otherwise INFERS working-state from the transcript
// tail, which can drift minutes wrong when this server or its SSE stalls (the
// "Churning 61m" freeze: an old prompt latched as the turn-start while the real
// turn was seconds fresh). Reading this file is the truth source; the tail is the
// fallback for sessions with no live process (retroactive history, crashed procs).

const LIVE_SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");

export type LiveSession = {
  pid: number;
  sessionId: string;
  cwd: string;
  status: string; // "busy" | "idle" | ...
  startedAt: number; // process start (ms)
  updatedAt: number; // last record write (ms)
  statusUpdatedAt: number; // when `status` last changed (ms) — busy ⇒ turn start
  kind: string; // "interactive" | ...
  version: string;
};

// The live record for a sessionId, or null when no running process owns it. Scans
// the (small) pid-keyed dir and matches on sessionId; if a session was resumed
// under a new pid, prefer the freshest record.
export function liveSessionStatus(sessionId: string | null): LiveSession | null {
  if (!sessionId) return null;
  let files: string[];
  try {
    files = fs.readdirSync(LIVE_SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return null; // no dir on this machine / older CLI — caller falls back to inference
  }
  let best: LiveSession | null = null;
  for (const f of files) {
    let rec: LiveSession;
    try {
      rec = JSON.parse(fs.readFileSync(path.join(LIVE_SESSIONS_DIR, f), "utf8"));
    } catch {
      continue; // partial/locked write — skip
    }
    if (rec?.sessionId !== sessionId) continue;
    if (!best || stamp(rec) > stamp(best)) best = rec;
  }
  return best;
}

// All currently-live sessions, freshest first. Used by readers that want the set
// of running processes (e.g. cross-checking which transcripts are still active).
export function liveSessions(): LiveSession[] {
  let files: string[];
  try {
    files = fs.readdirSync(LIVE_SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: LiveSession[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(LIVE_SESSIONS_DIR, f), "utf8")));
    } catch {
      // skip
    }
  }
  return out.sort((a, b) => stamp(b) - stamp(a));
}

// Claude Code stops updating the record when the process exits or wedges, so a
// stale record means "trust the transcript inference instead". 2 min covers a
// long thinking block (which leaves status busy but writes nothing for a while).
export const LIVE_FRESH_MS = 120_000;

export function isLiveFresh(rec: LiveSession | null, now: number): boolean {
  return !!rec && now - stamp(rec) < LIVE_FRESH_MS;
}

function stamp(rec: LiveSession): number {
  return rec.statusUpdatedAt || rec.updatedAt || 0;
}
