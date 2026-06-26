import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPathFor } from "@/lib/plugin-detail";
import { CLI_COMMANDS } from "@/lib/cli-registry";
import { parseFrontmatter } from "@/lib/frontmatter";

// The Commands LIBRARY — sibling of the Skills library. One list of every slash
// command, from three sources: (1) the harness BUILT-INS (the CLI registry —
// compiled into the binary, no file); (2) YOUR commands under ~/.claude/commands;
// and (3) commands shipped by ENABLED plugins (each plugin's commands/ dir). Same
// disk-is-the-database read as everything else.

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const USER_COMMANDS = path.join(CLAUDE_DIR, "commands");

export type CommandSource = "user" | "plugin" | "builtin";

export type LibraryCommand = {
  id: string;
  name: string; // the slash command, without the leading "/"
  description: string;
  argHint?: string;
  tokens: number; // ~4 chars/token; 0 for built-ins (no file)
  source: CommandSource;
  sourceLabel: string; // "You" · the plugin name · "Built-in"
  pluginRef?: string;
  path?: string; // .md/.toml file (user/plugin); built-ins have no file
};

const est = (s: string) => Math.round(s.length / 4);

function enabledRefs(): string[] {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, "settings.json"), "utf8"));
    const e = (s?.enabledPlugins as Record<string, boolean>) ?? {};
    return Object.keys(e).filter((k) => e[k] === true);
  } catch {
    return [];
  }
}

// A command file's description + arg hint — .md uses YAML frontmatter, .toml uses
// `description = "…"` keys.
function commandMeta(text: string, isToml: boolean): { description: string; argHint?: string } {
  if (isToml) {
    const d = text.match(/^\s*description\s*=\s*["']([^"']*)["']/m);
    const a = text.match(/^\s*argument-hint\s*=\s*["']([^"']*)["']/m);
    return { description: d?.[1] ?? "", argHint: a?.[1] };
  }
  const fm = parseFrontmatter(text);
  return { description: fm.description ?? "", argHint: fm["argument-hint"] };
}

function dirCommands(dir: string, source: CommandSource, sourceLabel: string, pluginRef?: string): LibraryCommand[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // no such dir
  }
  const out: LibraryCommand[] = [];
  for (const e of entries) {
    if (!e.isFile() || (!e.name.endsWith(".md") && !e.name.endsWith(".toml"))) continue;
    const name = e.name.replace(/\.(md|toml)$/, "");
    const file = path.join(dir, e.name);
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const meta = commandMeta(text, e.name.endsWith(".toml"));
    out.push({
      id: `${source}:${pluginRef ?? "user"}:${name}`,
      name,
      description: meta.description,
      argHint: meta.argHint || undefined,
      tokens: est(text),
      source,
      sourceLabel,
      pluginRef,
      path: file,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getCommandsLibrary(): LibraryCommand[] {
  const user = dirCommands(USER_COMMANDS, "user", "You");

  const plugin: LibraryCommand[] = [];
  for (const ref of enabledRefs()) {
    const ip = installPathFor(ref);
    if (ip) plugin.push(...dirCommands(path.join(ip, "commands"), "plugin", ref.split("@")[0], ref));
  }

  const builtin: LibraryCommand[] = CLI_COMMANDS.map((c) => ({
    id: `builtin:${c.name}`,
    name: c.name,
    description: c.desc,
    argHint: c.args,
    tokens: 0,
    source: "builtin",
    sourceLabel: "Built-in",
  }));

  return [...user, ...plugin, ...builtin];
}

// A command file's body for the drill-down (user/plugin only). Guarded to .md/.toml
// under ~/.claude so a ?path= can't escape.
export function readCommandBody(p: string): string | null {
  try {
    const resolved = path.resolve(p);
    if (!resolved.startsWith(CLAUDE_DIR + path.sep)) return null;
    if (!resolved.endsWith(".md") && !resolved.endsWith(".toml")) return null;
    const text = fs.readFileSync(resolved, "utf8");
    return text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  } catch {
    return null;
  }
}
