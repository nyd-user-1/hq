import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// {session_id → {pid, tty}} for the claude TUI that owns a session, written by the
// SessionStart hook (scripts/hooks/capture-session-pid.mjs). Lets hq close the
// terminal for a clean hand-off (the fork dialog's "Close terminal & continue
// here"): SIGTERM the pid AND close that tty's terminal tab.
export type SessionTui = { pid: number; tty: string };

// Back-compat: early entries were a bare number (no tty). Normalize both shapes.
export function tuiFor(sessionId: string): SessionTui | null {
  try {
    const map = JSON.parse(
      readFileSync(join(homedir(), ".claude", "hq", "session-pids.json"), "utf8"),
    );
    const v = map[sessionId];
    if (typeof v === "number") return v > 1 ? { pid: v, tty: "" } : null;
    if (v && typeof v.pid === "number" && v.pid > 1)
      return { pid: v.pid, tty: typeof v.tty === "string" ? v.tty : "" };
    return null;
  } catch {
    return null;
  }
}

// Convenience for callers that only need the pid.
export function pidFor(sessionId: string): number | null {
  return tuiFor(sessionId)?.pid ?? null;
}
