import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { teams, type Team } from "@/lib/teams";

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

export function recordTeamTmux(leadUuid: string, session: string): void {
  try {
    mkdirSync(join(homedir(), ".claude", "hq"), { recursive: true });
    const m = readSidecar();
    m[leadUuid] = session;
    const tmp = `${SIDECAR}.${randomUUID().slice(0, 8)}.tmp`; // unique — concurrent spawns can't race the temp
    writeFileSync(tmp, JSON.stringify(m));
    renameSync(tmp, SIDECAR);
  } catch {
    /* best-effort */
  }
}

// hq records every team IT spawned as { [leadUuid]: tmuxSession } — keyed by the
// FULL --session-id uuid it launched the lead with (which IS the lead's real
// transcript). We can't key by teamId: Claude Code (v2.1.197+) gives the TEAM its
// own internal id NOT derived from --session-id — the team dir + config.leadSessionId
// are a separate "session-<internal>" with no transcript file, while the uuid hq
// passed only names the lead's transcript. So we key by the one id hq controls and
// correlate back to the real team via shared tmux panes.
function spawnRecords(): Array<{ leadUuid: string; session: string }> {
  return Object.entries(readSidecar()).map(([leadUuid, session]) => ({
    leadUuid,
    session: String(session),
  }));
}

// The pane ids in a tmux session (across all its windows), or [].
function panesOf(session: string): string[] {
  try {
    return tmux(["list-panes", "-s", "-t", session, "-F", "#{pane_id}"])
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// The spawn record (if any) whose tmux session hosts this team — matched by a
// shared teammate pane. The bridge from a team on disk back to the hq-launched
// lead transcript. A cheap no-op for a team with no tmux panes (in-process).
function spawnRecordForTeam(team: Team): { leadUuid: string; session: string } | null {
  const teamPanes = team.members.filter((m) => isPaneId(m.tmuxPaneId)).map((m) => m.tmuxPaneId);
  if (!teamPanes.length) return null;
  for (const rec of spawnRecords()) {
    if (teamPanes.some((p) => panesOf(rec.session).includes(p))) return rec;
  }
  return null;
}

// The lead's REAL transcript id for a team. For an hq-spawned tmux team that's the
// uuid hq launched with (config.leadSessionId is the transcript-less internal team
// id); for every other team config.leadSessionId already IS the lead's transcript.
export function leadTranscriptFor(team: Team): string {
  return spawnRecordForTeam(team)?.leadUuid ?? team.leadSessionId;
}

// The tmux window that hosts a team — found via any teammate pane, else via the
// tmux session hq recorded when it spawned the team (correlated by panes).
function teamWindow(team: Team, teammatePanes: string[]): string | null {
  if (teammatePanes.length) {
    try {
      return tmux(["display-message", "-p", "-t", teammatePanes[0], "#{window_id}"]).trim() || null;
    } catch {
      /* fall through */
    }
  }
  const rec = spawnRecordForTeam(team);
  if (rec) {
    try {
      return tmux(["display-message", "-p", "-t", rec.session, "#{window_id}"]).trim() || null;
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
  const win = teamWindow(team, teammatePanes);
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
  // Match the terminal's resolved session against a team's REAL lead transcript
  // (the hq-spawned uuid) as well as config.leadSessionId (the in-process case).
  const team = teams().find(
    (t) => leadTranscriptFor(t) === leadSessionId || t.leadSessionId === leadSessionId,
  );
  if (!team) return null;
  const isTmux = team.members.some((m) => isPaneId(m.tmuxPaneId)) || !!spawnRecordForTeam(team);
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
// key interpretation), then a separate Enter submits. The `--` before the body
// is load-bearing: without it tmux parses a message that BEGINS WITH "-" as a
// flag and the send fails (verified live against tmux 3.6b) — `--` ends option
// parsing so the literal text is always treated as the operand.
export function sendToPane(paneId: string, text: string): { ok: boolean; error?: string } {
  if (!isPaneId(paneId)) return { ok: false, error: "not a tmux pane" };
  const body = (text ?? "").replace(/\r/g, "");
  if (!body.trim()) return { ok: false, error: "empty message" };
  try {
    tmux(["send-keys", "-t", paneId, "-l", "--", body]);
    tmux(["send-keys", "-t", paneId, "Enter"]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

// Spawn a brand-new team FROM hq: a detached tmux session running an interactive,
// team-aware, split-pane `claude` with a known --session-id (the lead's real
// TRANSCRIPT — Claude Code then mints the team its own internal id, so the team
// dir is NOT session-<uuid8>; hq records the uuid→tmuxSession map and correlates
// the real team back via tmux panes, see leadTranscriptFor). Delivers the prompt
// once claude has booted; the team materializes on disk over ~30s and the Teams
// panel's poll picks it up. The prompt fires from a timer so the request returns
// at once. `teamId` in the result is a provisional hint, not the real team dir.
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
    recordTeamTmux(uuid, session); // key by the lead's real transcript uuid
    // Deliver the task once claude's interactive TUI is READY — POLL capture-pane
    // for the input prompt rather than a fixed timer, so a slow boot never leaks the
    // task into the shell (it'd run as commands) and a fast boot isn't made to wait.
    // `--` guards a task that begins with "-". Caps at ~40s, then delivers anyway.
    const READY = /accept edits on|for shortcuts|❯|│\s*>|bypassing permissions/i;
    const deliver = (attempt: number) => {
      let ready = false;
      try {
        ready = READY.test(tmux(["capture-pane", "-p", "-t", session]));
      } catch {
        /* pane not capturable yet */
      }
      if (ready || attempt >= 18) {
        try {
          tmux(["send-keys", "-t", session, "-l", "--", task]);
          tmux(["send-keys", "-t", session, "Enter"]);
        } catch {
          /* the team is still spawned; the prompt just didn't land */
        }
        return;
      }
      setTimeout(() => deliver(attempt + 1), 2000);
    };
    setTimeout(() => deliver(0), 2500);
    return { ok: true, teamId, tmuxSession: session, leadSessionId: uuid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "tmux spawn failed" };
  }
}
