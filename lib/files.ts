import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "./atomic";

// The repo file index — a single walk of the source roots HQ "owns", turned into
// {path,rel,name,ext,bytes,mtime} records. This is the shared primitive behind
// THREE things: the Files search scope, the planner's chip validation
// (resolveFile), and component auto-discovery. Pure node:fs, in-process TTL
// cache. process.cwd() is the repo root for the Next server — the same
// assumption lib/search.ts (SCRIPTS_DIR) and lib/archive.ts (BUILD_SCRIPT) make.

const REPO_ROOT = process.cwd();
const ROOTS = ["app", "lib", "scripts"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".next-build",
  ".git",
  "dist",
  "build",
]);
// Re-walk at most every few seconds: a server render reads this once per request,
// and ~1k files walk in ~100ms, but rapid re-renders (typing) shouldn't re-stat
// the tree every keystroke. Dev edits land within one TTL — fine for search.
const FRESH_MS = 3000;

export type FileRecord = {
  path: string; // absolute
  rel: string; // repo-relative, e.g. "app/ui/terminal.tsx"
  name: string; // basename, e.g. "terminal.tsx"
  ext: string; // extension without the dot, e.g. "tsx" ("" if none)
  bytes: number;
  mtime: number; // ms
};

let cache: { at: number; files: FileRecord[] } | null = null;

function walk(dir: string, out: FileRecord[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // dotfiles + dot-dirs (covers .DS_Store)
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      out.push({
        path: full,
        rel: path.relative(REPO_ROOT, full),
        name: e.name,
        ext: path.extname(e.name).replace(/^\./, ""),
        bytes: st.size,
        mtime: st.mtimeMs,
      });
    }
  }
}

// The repo-root files themselves (package.json, next.config.ts, AGENTS.md,
// CLAUDE.md, tsconfig.json, eslint config, …) — top level only, no recursion
// into sibling dirs. These show up constantly as click-to-copy chips in the
// message stream, but the recursive walk below only covers the source ROOTS, so
// searching "AGENTS.md" or "next.config.ts" used to return nothing.
function rootFiles(out: FileRecord[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(REPO_ROOT, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || !e.isFile()) continue; // dirs handled by walk()
    const full = path.join(REPO_ROOT, e.name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    out.push({
      path: full,
      rel: e.name,
      name: e.name,
      ext: path.extname(e.name).replace(/^\./, ""),
      bytes: st.size,
      mtime: st.mtimeMs,
    });
  }
}

// The whole index (repo-root files + app/ + lib/ + scripts/), TTL-cached
// in-process.
export function getFiles(): FileRecord[] {
  const now = Date.now();
  if (cache && now - cache.at < FRESH_MS) return cache.files;
  const out: FileRecord[] = [];
  rootFiles(out);
  for (const r of ROOTS) walk(path.join(REPO_ROOT, r), out);
  cache = { at: now, files: out };
  return out;
}

function cleanGuess(g: string): string {
  return g.trim().replace(/^\.?\/+/, "");
}

export type ResolvedFile = {
  input: string; // the original guess, verbatim
  path: string | null; // absolute path of the (best) match, null if none
  rel: string | null; // repo-relative path of the match
  exists: boolean; // a real file resolved
  ambiguous: boolean; // basename matched >1 file (best-guess returned)
};

// Resolve an evaluator-guessed path (e.g. "page.tsx", "lib/planner.ts",
// "components/BatchOptimizer.tsx") against the real tree. Tiered: exact rel →
// suffix-of-rel (when the guess has a slash) → basename. >1 basename match is
// "ambiguous" (we still return a best guess, preferring app/ui). This is what
// lets the planner mark a chip real vs. a hallucinated path.
export function resolveFile(guess: string): ResolvedFile {
  const input = guess;
  const g = cleanGuess(guess);
  if (!g) return { input, path: null, rel: null, exists: false, ambiguous: false };
  const files = getFiles();

  let matches = files.filter((f) => f.rel === g);
  if (matches.length === 0 && g.includes("/")) {
    matches = files.filter((f) => f.rel.endsWith("/" + g));
  }
  if (matches.length === 0) {
    const base = g.split("/").pop()!;
    matches = files.filter((f) => f.name === base);
  }

  if (matches.length === 1) {
    const m = matches[0];
    return { input, path: m.path, rel: m.rel, exists: true, ambiguous: false };
  }
  if (matches.length > 1) {
    const best = matches.find((m) => m.rel.startsWith("app/ui/")) ?? matches[0];
    return { input, path: best.path, rel: best.rel, exists: true, ambiguous: true };
  }
  return { input, path: null, rel: null, exists: false, ambiguous: false };
}

// Read a repo-relative source file for the in-panel "open file" reader.
// Restricted to the walked roots + a ../-escape guard, so a crafted ?openFile=
// can't read outside the source tree.
export function getRepoFile(rel: string): string | null {
  const clean = cleanGuess(rel);
  const inRoot = ROOTS.some((r) => clean === r || clean.startsWith(r + "/"));
  const topLevel = clean.length > 0 && !clean.includes("/"); // a repo-root file like "AGENTS.md"
  if (!inRoot && !topLevel) return null;
  const full = path.join(REPO_ROOT, clean);
  if (path.relative(REPO_ROOT, full).startsWith("..")) return null;
  try {
    return fs.readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

// Overwrite a repo file — restricted to MARKDOWN only (editing .ts/.tsx source from
// a note modal is out of scope), inside the walked roots / repo-root, behind the
// same ..-escape guard as getRepoFile. Edit-only: a missing file returns false.
export function writeRepoFile(rel: string, content: string): boolean {
  const clean = cleanGuess(rel);
  if (!clean.endsWith(".md")) return false;
  const inRoot = ROOTS.some((r) => clean.startsWith(r + "/"));
  const topLevel = !clean.includes("/");
  if (!inRoot && !topLevel) return false;
  const full = path.join(REPO_ROOT, clean);
  if (path.relative(REPO_ROOT, full).startsWith("..")) return false;
  if (!fs.existsSync(full)) return false;
  try {
    writeFileAtomicSync(full, content);
    return true;
  } catch {
    return false;
  }
}
