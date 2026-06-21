import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// The one data source in v0: the HQ vault on disk. Plain fs, zero deps.
const VAULT_ROOT = path.join(os.homedir(), "vaults", "hq");
const CODE_ROOT = path.join(os.homedir(), "code");

export type Project = {
  /** Vault folder name, e.g. "!hq", "bank-it" */
  folder: string;
  /** Normalized slug used for the repo join, e.g. "hq", "bank-it" */
  slug: string;
  /** ~/code/<slug> if it exists on disk, else null */
  repoPath: string | null;
  /** Count of `NNN Topic/` thread folders */
  threadCount: number;
  /** Top items from the "## Roadmap" section of 002 Roadmap.md */
  roadmap: string[];
};

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---\n")) return md;
  const end = md.indexOf("\n---\n", 4);
  if (end === -1) return md;
  return md.slice(end + 5);
}

function safeReadDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Light cleanup of markdown inline syntax for plain-text rows. */
function plainText(line: string): string {
  return line
    .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, "$2") // [[link|label]] -> label
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/==([^=]+)==/g, "$1")
    .replace(/\*\(([^)]+)\)\*/g, "($1)")
    .trim();
}

function readRoadmap(projectDir: string): string[] {
  // The launchpad folder may carry a sort prefix (e.g. "*launchpad")
  const launchpad = safeReadDir(projectDir).find(
    (d) => d.isDirectory() && d.name.replace(/^[!*@_]/, "") === "launchpad"
  );
  if (!launchpad) return [];
  const file = path.join(projectDir, launchpad.name, "002 Roadmap.md");
  let md: string;
  try {
    md = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const body = stripFrontmatter(md);
  const section = body.split(/^## Roadmap\s*$/m)[1];
  if (!section) return [];
  const untilNext = section.split(/^## /m)[0];
  return untilNext
    .split("\n")
    .map((l) => l.match(/^\d+\.\s+(.*)$/)?.[1])
    .filter((l): l is string => Boolean(l))
    .map(plainText);
}

export function getProjects(): Project[] {
  return safeReadDir(VAULT_ROOT)
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => {
      const folder = d.name;
      const slug = folder.replace(/^[!*@_]/, "");
      const projectDir = path.join(VAULT_ROOT, folder);
      // Join rule is identical slugs; older repos may drop the hyphen (bank-it → bankit)
      const repoPath = [slug, slug.replace(/-/g, "")]
        .map((s) => path.join(CODE_ROOT, s))
        .find((p) => fs.existsSync(p));
      const threadCount = safeReadDir(projectDir).filter(
        (e) => e.isDirectory() && /^\d{3} /.test(e.name)
      ).length;
      return {
        folder,
        slug,
        repoPath: repoPath ?? null,
        threadCount,
        roadmap: readRoadmap(projectDir),
      };
    })
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

/** Read a note by vault-relative path, frontmatter stripped. Null if missing. */
export function getNote(relPath: string): string | null {
  try {
    // Guard the join so a crafted relPath (`../../etc/passwd`) can't escape the
    // vault. Currently has no callers, but it's the worst-shaped sink in the repo
    // — guard it now so it can't be wired up unsafely later (CODE-REVIEW SEC-8).
    const full = path.resolve(VAULT_ROOT, relPath);
    if (full !== VAULT_ROOT && !full.startsWith(VAULT_ROOT + path.sep)) return null;
    return stripFrontmatter(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

export function vaultRoot(): string {
  return VAULT_ROOT;
}

export type HandoffNote = { name: string; path: string; mtime: number };

// Newest vault note whose frontmatter says `kind: handoff` — the resume
// candidate the terminal offers on a fresh (post-/clear) session. Head-reads
// newest-first and exits on the first hit.
export function latestHandoff(): HandoffNote | null {
  const files: { full: string; name: string; mtime: number }[] = [];
  function walk(dir: string, depth: number) {
    if (depth > 3) return;
    for (const e of safeReadDir(dir)) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.name.endsWith(".md")) {
        try {
          files.push({
            full,
            name: e.name.replace(/\.md$/, ""),
            mtime: fs.statSync(full).mtimeMs,
          });
        } catch {
          // vanished mid-scan
        }
      }
    }
  }
  walk(VAULT_ROOT, 0);
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(0, 200)) {
    try {
      const fd = fs.openSync(f.full, "r");
      const buf = Buffer.alloc(512);
      const n = fs.readSync(fd, buf, 0, 512, 0);
      fs.closeSync(fd);
      const head = buf.toString("utf8", 0, n);
      if (head.startsWith("---") && /\nkind:\s*handoff\b/.test(head))
        return { name: f.name, path: f.full, mtime: f.mtime };
    } catch {
      // unreadable — skip
    }
  }
  return null;
}

export type PulseEntry = {
  project: string; // vault folder slug
  name: string; // file name
  rel: string; // path within the project folder
  mtime: number;
};

// Vault Pulse: the most recently touched files across every project folder —
// the vault's heartbeat. Bounded recursive walk (markdown + notes), newest first.
export function vaultPulse(limit = 12): PulseEntry[] {
  const out: PulseEntry[] = [];

  function walk(dir: string, project: string, base: string, depth: number) {
    if (depth > 3) return;
    for (const e of safeReadDir(dir)) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(full, project, rel, depth + 1);
      } else if (/\.(md|txt|canvas)$/i.test(e.name)) {
        try {
          out.push({
            project,
            name: e.name,
            rel,
            mtime: fs.statSync(full).mtimeMs,
          });
        } catch {
          // vanished mid-scan
        }
      }
    }
  }

  for (const d of safeReadDir(VAULT_ROOT)) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    const slug = d.name.replace(/^[!*@_]/, "");
    walk(path.join(VAULT_ROOT, d.name), slug, "", 0);
  }

  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}
