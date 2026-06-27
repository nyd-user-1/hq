import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPathFor } from "@/lib/plugin-detail";
import { parseFrontmatter } from "@/lib/frontmatter";

// The Agents LIBRARY — every subagent type Claude Code can dispatch via the Agent
// tool, read off disk the same "disk is the database" way as Skills. Three
// sources, each tagged: (1) YOUR agents under ~/.claude/agents/*.md; (2) agents
// shipped by ENABLED plugins (each plugin's installed agents/ dir, e.g. caveman's
// cavecrew-*); (3) the harness BUILT-INs (compiled into the CLI — Explore, Plan,
// general-purpose, …), curated since they have no file on disk. Each agent .md
// carries YAML frontmatter: name, description, optional tools + model.
//
// NOTE: this is the agent DEFINITIONS reader. Runtime subagent transcripts (the
// children a live session spawns) are a different thing — see lib/subagents.ts.

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const AGENTS_DIR = path.join(CLAUDE_DIR, "agents");

export type AgentSource = "user" | "plugin" | "builtin";

export type LibraryAgent = {
  id: string; // unique across sources
  name: string; // the agent type you reference
  description: string;
  tools: string; // frontmatter `tools` (e.g. "Read, Edit, Grep") — "" when unset
  model: string; // frontmatter `model` (e.g. "haiku") — "" when unset (inherits)
  source: AgentSource;
  sourceLabel: string; // "You" · the plugin name · "Built-in"
  path?: string; // the .md path (user/plugin); built-ins have no file on disk
};

// Built-ins ship inside the CLI (no .md on disk), so they're curated here — the
// always-available agent types the Agent tool exposes by default.
const BUILTIN_AGENTS: { name: string; description: string; tools: string }[] = [
  { name: "general-purpose", description: "Catch-all for researching complex questions, searching for code, and multi-step tasks when you're not confident the first match is right.", tools: "*" },
  { name: "Explore", description: "Read-only fan-out search agent — sweeps many files for the conclusion, not the file dumps. Locates code; doesn't review it.", tools: "All except Edit/Write" },
  { name: "Plan", description: "Software architect — designs an implementation plan, identifies critical files, weighs architectural trade-offs.", tools: "All except Edit/Write" },
  { name: "claude", description: "Catch-all for any task that doesn't fit a more specific agent.", tools: "*" },
  { name: "statusline-setup", description: "Configures the Claude Code status line setting.", tools: "Read, Edit" },
];

function normTools(v: string | undefined): string {
  if (!v) return "";
  // frontmatter may write a YAML flow list: `[Read, Edit, Write]` — unwrap it.
  return v.replace(/^\[|\]$/g, "").trim();
}

function readAgentsDir(dir: string, source: AgentSource, sourceLabel: string, idPrefix: string): LibraryAgent[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // no agents dir here
  }
  const out: LibraryAgent[] = [];
  for (const e of entries) {
    if (e.isDirectory() || !e.name.endsWith(".md")) continue;
    const file = path.join(dir, e.name);
    try {
      const fm = parseFrontmatter(fs.readFileSync(file, "utf8"));
      const name = fm.name || e.name.replace(/\.md$/, "");
      out.push({
        id: `${idPrefix}:${name}`,
        name,
        description: fm.description || "",
        tools: normTools(fm.tools),
        model: fm.model || "",
        source,
        sourceLabel,
        path: file,
      });
    } catch {
      // vanished mid-scan / unreadable
    }
  }
  return out;
}

function enabledRefs(): string[] {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, "settings.json"), "utf8"));
    const e = (s?.enabledPlugins as Record<string, boolean>) ?? {};
    return Object.keys(e).filter((k) => e[k] === true);
  } catch {
    return [];
  }
}

function pluginAgents(): LibraryAgent[] {
  const out: LibraryAgent[] = [];
  for (const ref of enabledRefs()) {
    const ip = installPathFor(ref);
    if (!ip) continue;
    const pluginName = ref.split("@")[0];
    out.push(...readAgentsDir(path.join(ip, "agents"), "plugin", pluginName, `plugin:${ref}`));
  }
  return out;
}

export function getAgentsLibrary(): LibraryAgent[] {
  const user = readAgentsDir(AGENTS_DIR, "user", "You", "user");
  const plugin = pluginAgents();
  const onDisk = new Set([...user, ...plugin].map((a) => a.name));
  const builtin: LibraryAgent[] = BUILTIN_AGENTS.filter((b) => !onDisk.has(b.name)).map((b) => ({
    id: `builtin:${b.name}`,
    name: b.name,
    description: b.description,
    tools: b.tools,
    model: "",
    source: "builtin",
    sourceLabel: "Built-in",
  }));
  return [...user, ...plugin, ...builtin];
}

// The agent .md body for the drill-down — frontmatter stripped (name/description
// already shown), returned as markdown. Guarded: only .md under ~/.claude (covers
// ~/.claude/agents AND plugin agents under plugins/…), so a ?path= can't escape.
export function readAgentBody(p: string): string | null {
  try {
    const resolved = path.resolve(p);
    if (!resolved.startsWith(CLAUDE_DIR + path.sep)) return null;
    if (!resolved.endsWith(".md")) return null;
    return fs.readFileSync(resolved, "utf8").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  } catch {
    return null;
  }
}
