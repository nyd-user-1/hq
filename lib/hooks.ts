import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HOOKS — the shell commands Claude Code runs around lifecycle events, read off
// disk from the settings files (the harness executes these, not the model). They
// live as a `hooks` block in up to four settings files, in precedence order:
//
//   ~/.claude/settings.json            (user)
//   ~/.claude/settings.local.json      (user, machine-local)
//   <repo>/.claude/settings.json       (project, shared)
//   <repo>/.claude/settings.local.json (project, machine-local)
//
// Shape: hooks[event] = [ { matcher?, hooks: [ { type, command } ] } ]. We flatten
// that into one entry per command, tagged with its event + source. Read-only —
// hooks load at session INIT, so HQ surfaces them, it doesn't edit them live.

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");

export type HookSource = "user" | "user-local" | "project" | "project-local";

export type HookEntry = {
  id: string;
  event: string; // PreToolUse · PostToolUse · SessionStart · Stop · …
  matcher: string; // the tool/event matcher ("" = fires for all)
  type: string; // usually "command"
  command: string;
  source: HookSource;
  sourceLabel: string;
};

type HookGroup = { matcher?: string; hooks?: { type?: string; command?: string }[] };
type Settings = { hooks?: Record<string, HookGroup[]> };

const SOURCE_LABEL: Record<HookSource, string> = {
  user: "User",
  "user-local": "User (local)",
  project: "Project",
  "project-local": "Project (local)",
};

function readSettings(file: string): Settings | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Settings;
  } catch {
    return null; // missing / unparseable
  }
}

function fromFile(file: string, source: HookSource): HookEntry[] {
  const s = readSettings(file);
  if (!s?.hooks) return [];
  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(s.hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((g, gi) => {
      const matcher = g.matcher ?? "";
      (g.hooks ?? []).forEach((h, hi) => {
        if (!h?.command) return;
        out.push({
          id: `${source}:${event}:${gi}:${hi}`,
          event,
          matcher,
          type: h.type || "command",
          command: h.command,
          source,
          sourceLabel: SOURCE_LABEL[source],
        });
      });
    });
  }
  return out;
}

// All configured hooks. `cwd` (the active repo) is optional — when given we also
// fold in that project's .claude settings, so the panel reflects the session's
// real, merged hook set.
export function getHooks(cwd?: string): HookEntry[] {
  const out: HookEntry[] = [
    ...fromFile(path.join(CLAUDE_DIR, "settings.json"), "user"),
    ...fromFile(path.join(CLAUDE_DIR, "settings.local.json"), "user-local"),
  ];
  if (cwd) {
    out.push(...fromFile(path.join(cwd, ".claude", "settings.json"), "project"));
    out.push(...fromFile(path.join(cwd, ".claude", "settings.local.json"), "project-local"));
  }
  return out;
}
