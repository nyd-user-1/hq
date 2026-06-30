import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { teams } from "@/lib/teams";

// Driving agent-team agents that run in tmux split-pane mode. Verified on disk:
// in `--teammate-mode tmux`, each teammate is a REAL `claude` TUI in its own tmux
// pane, and the config carries its pane id (e.g. "%2"). So hq can:
//   • READ  it — `tmux capture-pane -p -t %2`           (its live terminal)
//   • DRIVE it — `tmux send-keys -t %2 -l "<text>"` + Enter  (its real stdin)
// No fork, no mailbox — this is the agent's actual process. The LEAD pane carries
// the label "leader" (not a "%"), so we resolve it from the team's tmux window.

// tmux lives in /opt/homebrew/bin, which the launchd dev server's minimal PATH
// omits — augment PATH for our spawns (same env-leak as gh).
const TMUX_ENV = { ...process.env, PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin` };

// hq records {teamId → tmux session name} for teams IT spawned, so the lead pane
// is resolvable even before any teammate exists.
const SIDECAR = join(homedir(), ".claude", "hq", "team-tmux.json");

function isPaneId(s: string): boolean {
  return /^%\d+$/.test(s);
}

function tmux(args: string[], timeout = 4000): string {
  return execFileSync("tmux", args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    env: TMUX_ENV,
  });
}

function readSidecar(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(SIDECAR, "utf8"));
  } catch {
    return {};
  }
}

export function recordTeamTmux(teamId: string, session: string): void {
  try {
    mkdirSync(join(homedir(), ".claude", "hq"), { recursive: true });
    const m = readSidecar();
    m[teamId] = session;
    const tmp = `${SIDECAR}.tmp`;
    writeFileSync(tmp, JSON.stringify(m));
    renameSync(tmp, SIDECAR);
  } catch {
    /* best-effort */
  }
}

// The tmux window that hosts a team — found via any teammate pane, else via the
// tmux session hq recorded when it spawned the team.
function teamWindow(teamId: string, teammatePanes: string[]): string | null {
  if (teammatePanes.length) {
    try {
      return tmux(["display-message", "-p", "-t", teammatePanes[0], "#{window_id}"]).trim() || null;
    } catch {
      /* fall through */
    }
  }
  const sess = readSidecar()[teamId];
  if (sess) {
    try {
      return tmux(["display-message", "-p", "-t", sess, "#{window_id}"]).trim() || null;
    } catch {
      /* none */
    }
  }
  return null;
}

// The LEAD's real pane: in the team's tmux window, the pane that ISN'T a teammate.
export function leadPaneId(teamId: string): string | null {
  const team = teams().find((t) => t.id === teamId);
  if (!team) return null;
  const teammatePanes = team.members.filter((m) => isPaneId(m.tmuxPaneId)).map((m) => m.tmuxPaneId);
  const win = teamWindow(teamId, teammatePanes);
  if (!win) return null;
  let panes: string[];
  try {
    panes = tmux(["list-panes", "-t", win, "-F", "#{pane_id}"])
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
  const lead = panes.find((p) => !teammatePanes.includes(p));
  return lead && isPaneId(lead) ? lead : null;
}

// The pane id for ANY member (lead resolved from the window; teammate from config),
// or null when it isn't a drivable tmux pane.
export function memberPaneId(teamId: string, member: string): string | null {
  const team = teams().find((t) => t.id === teamId);
  if (!team) return null;
  const m = team.members.find((x) => x.name === member);
  if (!m) return null;
  if (m.isLead || m.name === "team-lead") return leadPaneId(teamId);
  return isPaneId(m.tmuxPaneId) ? m.tmuxPaneId : null;
}

// Is this session the LEAD of a tmux-mode team? Returns the teamId so callers can
// route the lead's send box to send-keys instead of a (forking) warm resume.
export function tmuxLeadTeamId(leadSessionId: string | null): string | null {
  if (!leadSessionId) return null;
  const team = teams().find((t) => t.leadSessionId === leadSessionId);
  if (!team) return null;
  const isTmux = team.members.some((m) => isPaneId(m.tmuxPaneId)) || !!readSidecar()[team.id];
  return isTmux ? team.id : null;
}

// The agent pane's visible terminal text, or null if gone / tmux unavailable.
export function capturePane(paneId: string): string | null {
  if (!isPaneId(paneId)) return null;
  try {
    return tmux(["capture-pane", "-p", "-t", paneId]).replace(/\s+$/, "");
  } catch {
    return null;
  }
}

// Type a message into an agent and submit it. `-l` sends the text literally (no
// key interpretation), then a separate Enter submits.
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

// Spawn a brand-new team FROM hq: a detached tmux session running an interactive,
// team-aware, split-pane `claude` with a known session id (so the teamId is
// deterministic), then deliver the spawn prompt once it has booted. Returns the
// ids; the team materializes on disk over the next ~30s and the Teams panel's
// poll picks it up. The prompt fires from a timer so the request returns at once.
export function spawnTeam(
  cwd: string,
  prompt: string,
): { ok: boolean; teamId?: string; tmuxSession?: string; leadSessionId?: string; error?: string } {
  const dir = (cwd ?? "").trim();
  const task = (prompt ?? "").trim();
  if (!dir || !task) return { ok: false, error: "cwd and prompt are required" };
  const uuid = randomUUID();
  const short = uuid.slice(0, 8);
  const teamId = `session-${short}`;
  const session = `hq-team-${short}`;
  try {
    tmux(["new-session", "-d", "-s", session, "-x", "220", "-y", "50", "-c", dir]);
    // Launch the interactive, split-pane, team-aware lead with the chosen id.
    tmux([
      "send-keys", "-t", session, "-l",
      `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --teammate-mode tmux --permission-mode acceptEdits --session-id ${uuid}`,
    ]);
    tmux(["send-keys", "-t", session, "Enter"]);
    recordTeamTmux(teamId, session);
    // Deliver the task once claude has booted (it can't accept input instantly).
    setTimeout(() => {
      try {
        tmux(["send-keys", "-t", session, "-l", task]);
        tmux(["send-keys", "-t", session, "Enter"]);
      } catch {
        /* the team is still spawned; the prompt just didn't land */
      }
    }, 13000);
    return { ok: true, teamId, tmuxSession: session, leadSessionId: uuid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "tmux spawn failed" };
  }
}
