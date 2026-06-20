import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// AGENT TEAMS — an experimental Claude Code feature gated behind
// CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1. When enabled, each team gets:
//
//   ~/.claude/teams/<team>/config.json  ← {members: [{name, agentId, agentType, sessionId}], …}
//
// The ~/.claude/teams/ dir does NOT exist unless the flag has been used, so this
// reader returns [] on virtually every machine. It's here so the Tree view can
// surface teams the moment they appear, with zero cost when they don't.

const TEAMS_DIR = path.join(os.homedir(), ".claude", "teams");

export type TeamMember = {
  name: string;
  agentId: string;
  agentType: string;
  sessionId: string;
};

export type Team = {
  id: string; // the teams/<id> dir name
  name: string;
  members: TeamMember[];
};

type Config = {
  name?: string;
  members?: Array<{ name?: string; agentId?: string; agentType?: string; sessionId?: string }>;
};

// All agent teams, or [] when the feature has never been enabled (the dir is
// absent). Defensive per-file so one bad config doesn't sink the rest.
export function teams(): Team[] {
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(TEAMS_DIR, { withFileTypes: true });
  } catch {
    return []; // no teams/ dir — the common case
  }
  const out: Team[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const cfgFile = path.join(TEAMS_DIR, d.name, "config.json");
    let cfg: Config;
    try {
      cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
    } catch {
      continue;
    }
    const members = Array.isArray(cfg.members) ? cfg.members : [];
    out.push({
      id: d.name,
      name: cfg.name || d.name,
      members: members.map((m) => ({
        name: m?.name || "",
        agentId: m?.agentId || "",
        agentType: m?.agentType || "",
        sessionId: m?.sessionId || "",
      })),
    });
  }
  return out;
}
