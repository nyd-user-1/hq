import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// AGENT TEAMS — an experimental Claude Code feature gated behind
// CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1. When enabled, each team gets a dir
// keyed by ("session-" + first 8 chars of the lead session id):
//
//   ~/.claude/teams/<teamId>/config.json    ← the roster (verified live)
//   ~/.claude/teams/<teamId>/inboxes/*.json ← ephemeral mailboxes (ignored here)
//
// The config.json shape (confirmed on disk):
//   {
//     "name": "session-73abaafe",
//     "createdAt": 1782801686227,
//     "leadAgentId": "team-lead@session-73abaafe",
//     "leadSessionId": "73abaafe-d3b2-4976-965d-9a1893c5f2b1",
//     "members": [
//       { "agentId":"team-lead@…", "name":"team-lead", "agentType":"team-lead",
//         "cwd":"/Users/…/hq", "backendType":"in-process", … },
//       { "agentId":"alpha@…", "name":"alpha", "agentType":"general-purpose",
//         "color":"blue", "model":"claude-opus-4-8", "prompt":"…",
//         "cwd":"/Users/…/hq", "backendType":"in-process", … }
//     ]
//   }
//
// The ~/.claude/teams/ dir does NOT exist unless the flag has been used, so this
// reader returns [] on virtually every machine. It's here so the Teams view can
// surface a team the moment it appears, with zero cost when none do. Defensive
// per-file so one bad config doesn't sink the rest.

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const TEAMS_DIR = path.join(os.homedir(), ".claude", "teams");

export type TeamMember = {
  name: string;
  agentId: string;
  agentType: string;
  color: string; // "" when the member declares none (the lead usually omits it)
  model: string; // e.g. "claude-opus-4-8"; "" when unset
  isLead: boolean; // name === "team-lead" || agentId === leadAgentId
  backendType: string; // "in-process" (default mode) | "tmux" (split-pane mode)
  // The teammate's tmux pane id (e.g. "%2") in split-pane mode — its REAL stdin,
  // so hq can `tmux send-keys -t <paneId>` to talk to it directly. In-process
  // members carry a label ("in-process"/"leader"), not a "%" pane.
  tmuxPaneId: string;
  cwd: string; // the member's working dir (drives the lead's project slug)
  prompt: string; // the teammate's spawn prompt; "" for the lead
};

export type Team = {
  id: string; // the teams/<id> dir name (== teamId, e.g. "session-73abaafe")
  name: string;
  leadSessionId: string; // the lead's full transcript UUID
  createdAt: number; // ms epoch; 0 when absent
  members: TeamMember[];
};

type RawMember = {
  name?: string;
  agentId?: string;
  agentType?: string;
  color?: string;
  model?: string;
  backendType?: string;
  tmuxPaneId?: string;
  cwd?: string;
  prompt?: string;
};

type Config = {
  name?: string;
  createdAt?: number;
  leadAgentId?: string;
  leadSessionId?: string;
  members?: RawMember[];
};

// All agent teams, or [] when the feature has never been enabled (the dir is
// absent — the common case).
export function teams(): Team[] {
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(TEAMS_DIR, { withFileTypes: true });
  } catch {
    return []; // no teams/ dir
  }
  const out: Team[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const cfgFile = path.join(TEAMS_DIR, d.name, "config.json");
    let cfg: Config;
    try {
      cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
    } catch {
      continue; // missing/bad config (e.g. a half-torn-down team dir)
    }
    const leadAgentId = cfg.leadAgentId || "";
    const rawMembers = Array.isArray(cfg.members) ? cfg.members : [];
    const members: TeamMember[] = rawMembers.map((m) => ({
      name: m?.name || "",
      agentId: m?.agentId || "",
      agentType: m?.agentType || "",
      color: m?.color || "",
      model: m?.model || "",
      isLead: m?.name === "team-lead" || (!!m?.agentId && m.agentId === leadAgentId),
      backendType: m?.backendType || "",
      tmuxPaneId: m?.tmuxPaneId || "",
      cwd: m?.cwd || "",
      prompt: m?.prompt || "",
    }));
    out.push({
      id: d.name,
      name: cfg.name || d.name,
      leadSessionId: cfg.leadSessionId || "",
      createdAt: typeof cfg.createdAt === "number" ? cfg.createdAt : 0,
      members,
    });
  }
  // Newest team first (createdAt is ms epoch); 0 sinks to the bottom.
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

// The lead member of a team (the one carrying the project cwd we slug from).
function leadMember(team: Team): TeamMember | null {
  return team.members.find((m) => m.isLead) || null;
}

// Locate the lead session's project dir — the immediate child of
// ~/.claude/projects that holds <leadSessionId>.jsonl. We prefer the cwd→slug
// transform Claude Code uses (path separators AND dots → "-", e.g.
// /Users/jane/Code/hq → -Users-jane-Code-hq; the same transform lib/transcript.ts
// derives the home slug with), then fall back to scanning every project dir for
// the one that actually contains the transcript — robust to a cwd/slug
// mismatch. Returns the absolute project-dir path, or null.
function leadProjectDir(team: Team): string | null {
  const lead = leadMember(team);
  const sid = team.leadSessionId;
  if (!sid) return null;

  // Primary: derive the slug from the lead's cwd.
  if (lead?.cwd) {
    const slug = lead.cwd.replace(/[/.]/g, "-");
    const dir = path.join(PROJECTS_ROOT, slug);
    try {
      // The nested per-session dir (which holds subagents/) is the strong
      // signal; the sibling <sid>.jsonl is the weaker fallback signal.
      if (
        fs.existsSync(path.join(dir, sid)) ||
        fs.existsSync(path.join(dir, `${sid}.jsonl`))
      ) {
        return dir;
      }
    } catch {
      // unreadable — fall through to the scan
    }
  }

  // Fallback: scan every project dir for the one owning this session.
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS_ROOT, d.name);
    try {
      if (
        fs.existsSync(path.join(dir, sid)) ||
        fs.existsSync(path.join(dir, `${sid}.jsonl`))
      ) {
        return dir;
      }
    } catch {
      // unreadable dir — skip
    }
  }
  return null;
}

// Resolve the absolute path to a teammate's subagent transcript .jsonl, or null.
//
// A teammate's transcript lives UNDER the lead's session dir (NOT as a top-level
// session), confirmed on disk:
//   ~/.claude/projects/<leadProjectSlug>/<leadSessionId>/subagents/
//       agent-a<name>-<hash>.jsonl
//       agent-a<name>-<hash>.meta.json   ← {name, teamName, agentType, …}
//
// The lead's OWN transcript is the normal top-level <leadSessionId>.jsonl and is
// not resolved here. We match a teammate two ways, most-robust first:
//   1. parse each *.meta.json and match meta.name === memberName &&
//      meta.teamName === team.name (the team id, e.g. "session-73abaafe");
//   2. fall back to the filename glob agent-a<name>-*.jsonl.
export function teamMemberTranscript(team: Team, memberName: string): string | null {
  if (!memberName) return null;
  const projDir = leadProjectDir(team);
  if (!projDir) return null;
  const subDir = path.join(projDir, team.leadSessionId, "subagents");

  let names: string[];
  try {
    names = fs.readdirSync(subDir);
  } catch {
    return null; // no subagents/ — the team produced no teammate transcripts
  }

  // 1) Authoritative: match the sidecar meta by name + teamName.
  for (const f of names) {
    if (!f.endsWith(".meta.json")) continue;
    let meta: { name?: string; teamName?: string };
    try {
      meta = JSON.parse(fs.readFileSync(path.join(subDir, f), "utf8"));
    } catch {
      continue;
    }
    if (meta?.name === memberName && (!team.name || meta?.teamName === team.name)) {
      const jsonl = path.join(subDir, f.replace(/\.meta\.json$/, ".jsonl"));
      if (fs.existsSync(jsonl)) return jsonl;
    }
  }

  // 2) Fallback: the agent-a<name>-<hash>.jsonl filename convention.
  const prefix = `agent-a${memberName}-`;
  for (const f of names) {
    if (f.startsWith(prefix) && f.endsWith(".jsonl")) {
      return path.join(subDir, f);
    }
  }

  return null;
}
