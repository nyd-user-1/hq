import { execFileSync } from "node:child_process";
import { teams } from "@/lib/teams";

// Driving agent-team TEAMMATES that run in tmux split-pane mode. Verified on disk:
// in `--teammate-mode tmux`, each teammate is a REAL `claude` TUI in its own tmux
// pane, and the team config carries its pane id (e.g. "%2"). So hq can:
//   • READ it  — `tmux capture-pane -p -t %2`  (the teammate's live terminal)
//   • DRIVE it — `tmux send-keys -t %2 -l "<text>"` + Enter  (its real stdin)
// No fork, no mailbox — this is the teammate's actual process. (In-process mode
// carries a label like "in-process"/"leader" instead of a "%" pane; those aren't
// directly drivable, and these helpers return null/false for them.)

// tmux lives in /opt/homebrew/bin, which the launchd dev server's minimal PATH
// omits (the same env-leak as gh) — augment PATH for our spawns.
const TMUX_ENV = {
  ...process.env,
  PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin`,
};

// A real tmux pane id is "%" followed by digits. Anything else (a label, or empty)
// is not a drivable pane — and validating this also keeps the value safe to pass
// to tmux as a target.
function isPaneId(s: string): boolean {
  return /^%\d+$/.test(s);
}

// The teammate's tmux pane id, or null when it isn't a tmux-backed pane (in-process
// mode, the lead, an unknown member, or no live team).
export function memberPaneId(teamId: string, member: string): string | null {
  const team = teams().find((t) => t.id === teamId);
  if (!team) return null;
  const m = team.members.find((x) => x.name === member);
  if (!m) return null;
  return isPaneId(m.tmuxPaneId) ? m.tmuxPaneId : null;
}

function tmux(args: string[], opts: { timeout?: number } = {}): string {
  return execFileSync("tmux", args, {
    encoding: "utf8",
    timeout: opts.timeout ?? 4000,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    env: TMUX_ENV,
  });
}

// The teammate pane's visible terminal text (its live view), or null if the pane
// is gone / tmux unavailable.
export function capturePane(paneId: string): string | null {
  if (!isPaneId(paneId)) return null;
  try {
    return tmux(["capture-pane", "-p", "-t", paneId]).replace(/\s+$/, "");
  } catch {
    return null;
  }
}

// Type a message into the teammate and submit it — `send-keys -l` sends the text
// literally (no key interpretation, so it can't smuggle control sequences), then a
// separate Enter submits.
export function sendToPane(paneId: string, text: string): { ok: boolean; error?: string } {
  if (!isPaneId(paneId)) return { ok: false, error: "not a tmux pane" };
  const body = (text ?? "").replace(/\r/g, "");
  if (!body.trim()) return { ok: false, error: "empty message" };
  try {
    tmux(["send-keys", "-t", paneId, "-l", body]);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}
