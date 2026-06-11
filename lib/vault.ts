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
    return stripFrontmatter(
      fs.readFileSync(path.join(VAULT_ROOT, relPath), "utf8")
    );
  } catch {
    return null;
  }
}

export function vaultRoot(): string {
  return VAULT_ROOT;
}
