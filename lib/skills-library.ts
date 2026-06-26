import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSkills } from "@/lib/skills";
import { installPathFor } from "@/lib/plugin-detail";

// The Skills LIBRARY — the "explode the plugins into capabilities" reader. One
// unified list of every skill available to you, from three sources, each tagged
// with where it came from: (1) YOUR skills under ~/.claude/skills; (2) skills
// shipped by ENABLED plugins (read from each plugin's installed skills/ dir); and
// (3) the harness BUILT-INs (compiled into the CLI, no SKILL.md on disk, so
// curated). Same disk-is-the-database read as the rest of hq.

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");

export type SkillSource = "user" | "plugin";

export type LibrarySkill = {
  id: string; // unique across sources
  name: string; // slug → the /<name> command
  title: string;
  description: string;
  tokens: number; // ~4 chars/token estimate
  argHint?: string;
  source: SkillSource;
  sourceLabel: string; // "You" · the plugin name
  pluginRef?: string;
  path: string; // SKILL.md path — every library skill is a real file on disk
};

const est = (s: string) => Math.round(s.length / 4);

// First --- … --- block as flat key: value pairs (matches lib/skills).
function frontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return out;
  for (const line of block[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
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

function pluginSkills(): LibrarySkill[] {
  const out: LibrarySkill[] = [];
  for (const ref of enabledRefs()) {
    const ip = installPathFor(ref);
    if (!ip) continue;
    const dir = path.join(ip, "skills");
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // plugin ships no skills
    }
    const pluginName = ref.split("@")[0];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const file = path.join(dir, e.name, "SKILL.md");
      try {
        const text = fs.readFileSync(file, "utf8");
        const fm = frontmatter(text);
        out.push({
          id: `plugin:${ref}:${e.name}`,
          name: e.name,
          title: fm.name || e.name,
          description: fm.description || "",
          tokens: est(text),
          argHint: fm["argument-hint"] || undefined,
          source: "plugin",
          sourceLabel: pluginName,
          pluginRef: ref,
          path: file,
        });
      } catch {
        // no SKILL.md / vanished mid-scan
      }
    }
  }
  return out;
}

// The SKILL.md body for the drill-down — frontmatter stripped (name/description
// already shown), returned as markdown. Guarded: only .md files under ~/.claude
// (covers ~/.claude/skills AND plugin skills under plugins/cache/…), so a ?path=
// can't escape to read elsewhere.
export function readSkillBody(p: string): string | null {
  try {
    const resolved = path.resolve(p);
    if (!resolved.startsWith(CLAUDE_DIR + path.sep)) return null;
    if (!resolved.endsWith(".md")) return null;
    const text = fs.readFileSync(resolved, "utf8");
    return text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  } catch {
    return null;
  }
}

export function getSkillsLibrary(): LibrarySkill[] {
  const user: LibrarySkill[] = getSkills().map((s) => ({
    id: `user:${s.name}`,
    name: s.name,
    title: s.title,
    description: s.description,
    tokens: s.tokens,
    argHint: s.argHint || undefined,
    source: "user",
    sourceLabel: "You",
    path: s.path,
  }));

  return [...user, ...pluginSkills()];
}
