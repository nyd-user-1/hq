import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPathFor } from "@/lib/plugin-detail";
import { parseFrontmatter } from "@/lib/frontmatter";

// The Output-Styles LIBRARY — every output style you can switch the session to
// with `/output-style <name>`, read off disk. Three sources, each tagged: (1)
// YOUR styles under ~/.claude/output-styles/*.md; (2) styles shipped by ENABLED
// plugins (each plugin's installed output-styles/ dir); (3) the harness BUILT-INs
// (default · Explanatory · Learning), curated since they have no file on disk.
// Each style .md carries YAML frontmatter (name + description) over a markdown
// body that IS the system-prompt adjustment the style applies.

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const STYLES_DIR = path.join(CLAUDE_DIR, "output-styles");

export type StyleSource = "user" | "plugin" | "builtin";

export type LibraryStyle = {
  id: string;
  name: string; // the /output-style argument
  description: string;
  source: StyleSource;
  sourceLabel: string; // "You" · the plugin name · "Built-in"
  path?: string; // the .md path; built-ins have no file on disk
};

// The styles the CLI ships with (no .md on disk).
const BUILTIN_STYLES: { name: string; description: string }[] = [
  { name: "default", description: "Claude Code's standard output — concise, action-oriented engineering responses." },
  { name: "Explanatory", description: "Adds educational ‘insight’ asides that explain the reasoning behind implementation choices as it works." },
  { name: "Learning", description: "Collaborative, learn-by-doing mode — pauses to have you write small pieces of the code yourself." },
];

function readStylesDir(dir: string, source: StyleSource, sourceLabel: string, idPrefix: string): LibraryStyle[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LibraryStyle[] = [];
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

function pluginStyles(): LibraryStyle[] {
  const out: LibraryStyle[] = [];
  for (const ref of enabledRefs()) {
    const ip = installPathFor(ref);
    if (!ip) continue;
    const pluginName = ref.split("@")[0];
    out.push(...readStylesDir(path.join(ip, "output-styles"), "plugin", pluginName, `plugin:${ref}`));
  }
  return out;
}

export function getStylesLibrary(): LibraryStyle[] {
  const user = readStylesDir(STYLES_DIR, "user", "You", "user");
  const plugin = pluginStyles();
  const onDisk = new Set([...user, ...plugin].map((s) => s.name));
  const builtin: LibraryStyle[] = BUILTIN_STYLES.filter((b) => !onDisk.has(b.name)).map((b) => ({
    id: `builtin:${b.name}`,
    name: b.name,
    description: b.description,
    source: "builtin",
    sourceLabel: "Built-in",
  }));
  return [...user, ...plugin, ...builtin];
}

// The style .md body for the drill-down — frontmatter stripped, returned as
// markdown. Guarded: only .md under ~/.claude, so a ?path= can't escape.
export function readStyleBody(p: string): string | null {
  try {
    const resolved = path.resolve(p);
    if (!resolved.startsWith(CLAUDE_DIR + path.sep)) return null;
    if (!resolved.endsWith(".md")) return null;
    return fs.readFileSync(resolved, "utf8").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  } catch {
    return null;
  }
}
