import { NextResponse } from "next/server";
import { statSync } from "node:fs";
import { basename } from "node:path";
import { listRepls } from "@/lib/repl";
import { getRecentSessions, getSessions, isLiveTerminal, sessionMeta } from "@/lib/sessions";
import { getSessionsMeta } from "@/lib/sessions-meta";
import { sessionFilePath } from "@/lib/transcript";

export const dynamic = "force-dynamic";

// GET /api/terminal/repl/list → THE FLEET — every LIVE session, of two kinds:
//   CONTROL  = a warm agent the daemon holds → hq drives it (send turns, stop).
//   OBSERVE  = a live Claude Code terminal hq is NOT driving → it can mirror it
//              from disk but not steer it ("take the wheel" converts it to control).
// Each row enriched with project/title/branch from the transcript. Read-only; the
// daemon is the source of who's-driven, the transcript is the source of who's-live.
const WORKING_MS = 45 * 1000; // a terminal written this recently is plausibly mid-stream

export type FleetRow = {
  key: string;
  sessionId: string | null;
  mode: "control" | "observe";
  project: string;
  title: string;
  branch: string;
  cwd: string;
  running: boolean;
  busy: boolean; // mid-turn right now
  pending: number; // permission asks awaiting an answer (control only)
  watched: boolean; // a UI client is attached to its stream
  startedAt: number;
  lastActivity: number;
  contextTokens: number; // current context-window size → the runway fill; 0 if unknown
};

export async function GET() {
  const meta = getSessionsMeta();
  const agents = await listRepls();
  const driven = new Set(agents.map((a) => a.sessionId || a.key));
  // Join each row's current context-window size for the runway. getSessions reads
  // off the same incremental usage cache, so this is cheap on a warm poll.
  const ctxBySession = new Map(getSessions(120).map((s) => [s.id, s.contextTokens]));

  // CONTROL — every warm agent the daemon holds.
  const control: FleetRow[] = agents.map((a): FleetRow => {
    const id = a.sessionId || a.key;
    let project = a.cwd ? basename(a.cwd) : "session";
    let title = "new session";
    let branch = "";
    try {
      const file = sessionFilePath(id);
      const m = sessionMeta(file, statSync(file).mtimeMs, meta);
      project = m.project;
      title = m.customTitle || m.aiTitle || m.title;
      branch = m.branch;
    } catch {
      /* no transcript head yet — keep the cwd-derived fallbacks */
    }
    return {
      key: a.key,
      sessionId: a.sessionId,
      mode: "control",
      project,
      title,
      branch,
      cwd: a.cwd,
      running: a.running,
      busy: a.busy,
      pending: a.pending,
      watched: a.subscribers > 0,
      startedAt: a.startedAt,
      lastActivity: a.lastActivity,
      contextTokens: ctxBySession.get(id) ?? 0,
    };
  });

  // OBSERVE — live Claude Code terminals hq is NOT driving (active < 5 min + a
  // terminal surface). isLiveTerminal only tail-reads the few active candidates.
  const now = Date.now();
  const observe: FleetRow[] = getRecentSessions(30)
    .filter((s) => s.active && !driven.has(s.id) && isLiveTerminal(s.id))
    .map((s): FleetRow => ({
      key: s.id,
      sessionId: s.id,
      mode: "observe",
      project: s.project,
      title: s.customTitle || s.aiTitle || s.title,
      branch: s.branch,
      cwd: s.cwd ?? "",
      running: true,
      busy: now - s.lastActive < WORKING_MS, // recency proxy for "mid-stream"
      pending: 0,
      watched: false,
      startedAt: s.lastActive,
      lastActivity: s.lastActive,
      contextTokens: ctxBySession.get(s.id) ?? 0,
    }));

  const rows = [...control, ...observe];
  // Attention first: needs-you, then working, then most-recently-active.
  rows.sort(
    (x, y) =>
      Number(y.pending > 0) - Number(x.pending > 0) ||
      Number(y.busy) - Number(x.busy) ||
      y.lastActivity - x.lastActivity,
  );
  return NextResponse.json({ agents: rows });
}
