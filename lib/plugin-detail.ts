import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isEnabled } from "@/lib/plugin-catalog";

// On-demand detail for ONE plugin — read when its card is opened in the drill-
// down, so the 242-row catalog list stays cheap. Pulls three things off disk and
// merges them: (1) the marketplace manifest entry (description, author, category,
// homepage, source repo + pinned ref/sha); (2) the install record in
// plugins/installed_plugins.json (installPath, version, sha); (3) — the value-add
// — WHAT THE PLUGIN SHIPS, by enumerating the installed dir's commands/, agents/,
// skills/ and the hooks declared in .claude-plugin/plugin.json. Nothing here hits
// the network: it's the same read-what-Claude-wrote-to-disk premise as the rest.

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const MARKETPLACES = path.join(CLAUDE_DIR, "plugins", "marketplaces");
const INSTALLED = path.join(CLAUDE_DIR, "plugins", "installed_plugins.json");
const KNOWN = path.join(CLAUDE_DIR, "plugins", "known_marketplaces.json");
const CACHE = path.join(CLAUDE_DIR, "plugins", "cache");

export type PluginShips = {
  commands: string[];
  agents: string[];
  skills: string[];
  hooks: string[];
};

export type PluginDetail = {
  ref: string;
  name: string;
  marketplace: string;
  description: string;
  author?: string;
  category?: string;
  homepage?: string;
  repo?: string; // the source git repo (https), .git stripped
  version?: string; // a tag/version, "unknown" filtered out
  sha?: string; // short commit sha
  installed: boolean;
  enabled: boolean;
  ships: PluginShips;
};

type RawSource = { url?: string; ref?: string; sha?: string; path?: string };
type RawEntry = {
  name?: string;
  description?: string;
  category?: string;
  author?: { name?: string } | string;
  homepage?: string;
  source?: string | RawSource;
};

function splitRef(ref: string): { name: string; market: string } | null {
  const at = ref.lastIndexOf("@");
  if (at < 1) return null;
  return { name: ref.slice(0, at), market: ref.slice(at + 1) };
}

// the manifest entry for this ref, scanning every registered marketplace.
function manifestEntry(name: string, market: string): RawEntry | null {
  let dirs: string[];
  try {
    dirs = fs
      .readdirSync(MARKETPLACES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    let mf: string | undefined;
    for (const c of [".claude-plugin/marketplace.json", "marketplace.json"]) {
      const p = path.join(MARKETPLACES, dir, c);
      if (fs.existsSync(p)) {
        mf = p;
        break;
      }
    }
    if (!mf) continue;
    let j: { name?: string; plugins?: RawEntry[] };
    try {
      j = JSON.parse(fs.readFileSync(mf, "utf8"));
    } catch {
      continue;
    }
    const mName = typeof j.name === "string" ? j.name : dir;
    if (mName !== market) continue;
    return (j.plugins ?? []).find((p) => p?.name === name) ?? null;
  }
  return null;
}

// installPath + version + sha — from installed_plugins.json first, then a
// cache/<market>/<plugin>/<ver-or-sha>/ scan (CC doesn't always record every
// plugin in installed_plugins.json — e.g. a freshly enabled one).
function installInfo(
  ref: string,
  name: string,
  market: string,
): { installPath?: string; version?: string; sha?: string } {
  try {
    const j = JSON.parse(fs.readFileSync(INSTALLED, "utf8"));
    const a = j?.plugins?.[ref];
    if (Array.isArray(a) && a[0]?.installPath) {
      const v = typeof a[0].version === "string" && a[0].version !== "unknown" ? a[0].version : undefined;
      return { installPath: a[0].installPath, version: v, sha: a[0].gitCommitSha };
    }
  } catch {
    /* fall through to cache scan */
  }
  const base = path.join(CACHE, market, name);
  try {
    const subs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (!subs.length) return {};
    let best = subs[0].name;
    let bestM = -1;
    for (const s of subs) {
      const m = fs.statSync(path.join(base, s.name)).mtimeMs;
      if (m >= bestM) {
        bestM = m;
        best = s.name;
      }
    }
    return { installPath: path.join(base, best) };
  } catch {
    return {};
  }
}

function baseNames(dir: string, exts: string[]): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && exts.some((x) => e.name.endsWith(x)))
      .map((e) => e.name.replace(/\.[^.]+$/, ""))
      .sort();
  } catch {
    return [];
  }
}

// skills are usually a dir-per-skill (each holds SKILL.md); fall back to loose
// .md/.skill files for plugins that lay them out flat.
function listSkills(dir: string): string[] {
  try {
    const subs = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    if (subs.length) return subs;
  } catch {
    return [];
  }
  return baseNames(dir, [".md", ".skill"]);
}

function readShips(installPath: string): { ships: PluginShips; pj?: RawEntry & { hooks?: Record<string, unknown> } } {
  const commands = baseNames(path.join(installPath, "commands"), [".toml", ".md"]);
  const agents = baseNames(path.join(installPath, "agents"), [".md"]);
  const skills = listSkills(path.join(installPath, "skills"));
  let hooks: string[] = [];
  let pj: (RawEntry & { hooks?: Record<string, unknown> }) | undefined;
  try {
    pj = JSON.parse(fs.readFileSync(path.join(installPath, ".claude-plugin", "plugin.json"), "utf8"));
    if (pj?.hooks && typeof pj.hooks === "object") hooks = Object.keys(pj.hooks);
  } catch {
    /* no plugin.json */
  }
  return { ships: { commands, agents, skills, hooks }, pj };
}

function authorName(a: RawEntry["author"]): string | undefined {
  if (typeof a === "string") return a;
  if (a && typeof a.name === "string") return a.name;
  return undefined;
}

// the marketplace's own source repo → https url. For indie marketplaces (caveman,
// ponytail) the marketplace IS the plugin repo, so this is the repo link when the
// per-plugin manifest `source` is sparse (e.g. "./").
function marketplaceRepo(market: string): string | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(KNOWN, "utf8"));
    const repo = j?.[market]?.source?.repo;
    if (typeof repo === "string" && repo.includes("/")) return `https://github.com/${repo}`;
  } catch {
    /* no known_marketplaces.json */
  }
  return undefined;
}

// The on-disk root of an installed plugin (or undefined if not installed) —
// reused by the capability libraries (skills/agents/commands) to enumerate what
// each enabled plugin ships.
export function installPathFor(ref: string): string | undefined {
  const parts = splitRef(ref);
  if (!parts) return undefined;
  return installInfo(ref, parts.name, parts.market).installPath;
}

export function getPluginDetail(ref: string): PluginDetail | null {
  const parts = splitRef(ref);
  if (!parts) return null;
  const { name, market } = parts;
  const entry = manifestEntry(name, market);

  const inst = installInfo(ref, name, market);
  const installed = !!inst.installPath;
  const { ships, pj } = installed ? readShips(inst.installPath!) : { ships: { commands: [], agents: [], skills: [], hooks: [] }, pj: undefined };

  const src = entry?.source;
  const source: RawSource | undefined = typeof src === "object" ? src : undefined;
  const repo =
    (source?.url ? source.url.replace(/\.git$/, "") : undefined) ?? marketplaceRepo(market);

  // the installed plugin.json is often richer than a sparse marketplace entry.
  const description = pj?.description || entry?.description || "";
  const author = authorName(pj?.author) ?? authorName(entry?.author);
  const homepage = entry?.homepage;
  const version = inst.version ?? source?.ref;
  const sha = (inst.sha ?? source?.sha)?.slice(0, 7);

  return {
    ref,
    name,
    marketplace: market,
    description,
    author,
    category: entry?.category,
    homepage,
    repo,
    version,
    sha,
    installed,
    enabled: isEnabled(ref),
    ships,
  };
}
