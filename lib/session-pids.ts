import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// {session_id → the claude TUI's PID}, written by the SessionStart hook
// (scripts/hooks/capture-session-pid.mjs). Lets hq close the terminal for a clean
// hand-off (the fork dialog's "Close terminal & continue").
export function pidFor(sessionId: string): number | null {
  try {
    const map = JSON.parse(
      readFileSync(join(homedir(), ".claude", "hq", "session-pids.json"), "utf8"),
    );
    const pid = map[sessionId];
    return typeof pid === "number" && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}
