import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HQ config — the disk IS the database. A tiny, optional sidecar at
// ~/.claude/hq/config.json. Zero-config defaults make HQ work for everyone the
// moment it's installed; the only knob most people touch is `projectsRoot`.
//
//   { "projectsRoot": "~/code" }   // where "+ New project" creates folders
//
// THE INVARIANT (see the new-session flow): no HQ chat is ever born in the bare
// home dir. With nothing selected, a chat starts in the DEFAULT WORKSPACE (~/hq),
// which is created on first use. Claude Code fixes a session's cwd at launch and
// can never re-anchor it, so the folder is always a birth-time decision.
// The Claude Code config root. Respects CLAUDE_CONFIG_DIR (Claude Code's own
// relocation knob) so hq reads the SAME place the CLI writes; falls back to
// ~/.claude. Use this instead of hardcoding os.homedir()/".claude" so a user who
// relocated their config dir still gets a working Sessions/Transcripts/Teams/
// Skills/Memory core, not empty panels.
export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

// Resolve a repo-relative asset (a sidecar .mjs, an automation script, a source
// dir) so it works in EVERY run mode, not just `next dev`:
//   • dev / `next start` from the repo → process.cwd() IS the repo root.
//   • standalone server (bin/hq-offline, npm global) → cwd is <pkg>/.next/standalone;
//     the asset ships at the package root via package.json "files", i.e. cwd/../..
//   • desktop .app → the packaging script copies the sidecars INTO the standalone
//     dir, so cwd/<rel> resolves.
// Returns the first existing candidate; falls back to the cwd-relative path so
// existence-checking callers and error messages still point somewhere sane.
export function repoAsset(...segments: string[]): string {
  const rel = path.join(...segments);
  for (const root of [process.cwd(), path.join(process.cwd(), "..", "..")]) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) return p;
  }
  return path.join(process.cwd(), rel);
}

// The user's projects root for the cross-repo readers (Shipped, Changelog, Memory
// Audit, vault). Hardcoding lowercase "code" silently returned NOTHING on a
// case-sensitive volume (or a user whose dir is "~/Code" — like this very repo),
// with no error. Pick whichever case actually exists; default to ~/code.
export function codeRoot(): string {
  const home = os.homedir();
  for (const name of ["code", "Code"]) {
    const p = path.join(home, name);
    try {
      if (fs.statSync(p).isDirectory()) return p;
    } catch {
      /* not this case */
    }
  }
  return path.join(home, "code");
}

const DIR = path.join(claudeHome(), "hq");
const FILE = path.join(DIR, "config.json");

type HqConfig = { projectsRoot?: string };

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// The always-present catch-all. Every unanchored chat lands here, never ~.
export function defaultWorkspace(): string {
  return path.join(os.homedir(), "hq");
}

// Where "+ New project" creates folders (and a scan source for the launcher
// chips). Default ~/hq for everyone; a user keeps their own layout by setting
// `projectsRoot` (e.g. "~/code"). Falls back to the default workspace.
export function projectsRoot(): string {
  try {
    const c = JSON.parse(fs.readFileSync(FILE, "utf8")) as HqConfig;
    if (c && typeof c.projectsRoot === "string" && c.projectsRoot.trim()) {
      return expandHome(c.projectsRoot.trim());
    }
  } catch {
    /* missing / corrupt → default */
  }
  return defaultWorkspace();
}

// Make a filesystem-safe project folder name. Strips path separators and `..`
// (no traversal), collapses whitespace to dashes, trims to something sane.
export function sanitizeProjectName(raw: string): string {
  return raw
    .trim()
    .replace(/[/\\]+/g, "-") // no separators → can't escape the root
    .replace(/\.\.+/g, ".") // no parent-dir hops
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "") // conservative, cross-platform
    .replace(/^[.-]+/, "") // no leading dot/dash (hidden / odd)
    .slice(0, 64);
}

export function ensureDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// Guard a driven-session launch dir. A driven `claude` inherits the cwd's trust
// — its .git/hooks, CLAUDE.md, .claude/settings.json all execute/load — so an
// attacker-chosen cwd (/etc, /, another user's tree, a planted repo) is a
// code-exec vector (CODE-REVIEW SEC-4). Resolves symlinks/.. via realpath and
// requires the result to be a real directory strictly INSIDE the user's home
// (never the bare home). Returns the resolved path, or null if disallowed.
export function safeWorkspace(cwd: string): string | null {
  try {
    const real = fs.realpathSync(cwd);
    const home = os.homedir();
    if (!fs.statSync(real).isDirectory()) return null;
    if (real === home || !real.startsWith(home + path.sep)) return null;
    return real;
  } catch {
    return null;
  }
}
