import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// The standing context tax: instruction files Claude Code loads into context
// at the START of every session — global CLAUDE.md + the MEMORY.md index for
// home sessions, plus each project's CLAUDE.md/AGENTS.md for project sessions.
// Every token here is paid again on every single session. Token counts are the
// ~4 chars/token estimate.

const HOME = os.homedir();
const MEMORY_DIR = path.join(
  HOME,
  ".claude",
  "projects",
  `-${HOME.slice(1).replaceAll("/", "-")}`,
  "memory"
);
const CODE_DIR = path.join(HOME, "code");
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

export type AuditFile = {
  label: string;
  tokens: number;
  mtime: number;
  path: string; // absolute path — the row opens this .md in the panel
};

export type MemoryEntry = {
  name: string;
  description: string;
  tokens: number;
  mtime: number;
  stale: boolean; // untouched for 30+ days — prune candidate
  path: string; // absolute path — the row opens this .md in the panel
};

const est = (s: string) => Math.round(s.length / 4);

function fileTokens(file: string, label: string): AuditFile | null {
  try {
    const text = fs.readFileSync(file, "utf8");
    return { label, tokens: est(text), mtime: fs.statSync(file).mtimeMs, path: file };
  } catch {
    return null;
  }
}

// Read one of the audit's .md files for the in-panel reader. Guarded: only files
// under the home dir and only .md, so an ?open=<path> param can't read arbitrary
// files off disk.
export function readAuditDoc(p: string): string | null {
  try {
    const resolved = path.resolve(p);
    if (!resolved.endsWith(".md")) return null;
    // Only the docs the audit actually surfaces: instruction/memory files under
    // ~/.claude, and project CLAUDE.md/AGENTS.md under the code root — NOT all of
    // $HOME (which would expose any private .md off disk) (CODE-REVIEW SEC-6).
    const inRoot = (root: string) =>
      resolved === root || resolved.startsWith(root + path.sep);
    if (!inRoot(path.join(HOME, ".claude")) && !inRoot(CODE_DIR)) return null;
    return fs.readFileSync(resolved, "utf8");
  } catch {
    return null;
  }
}

export function getAudit(): {
  everySession: AuditFile[]; // loaded by every home session
  perProject: AuditFile[]; // each project's CLAUDE.md / AGENTS.md
  memory: MemoryEntry[]; // the store behind the index, heaviest first
  memoryTotalTokens: number;
  staleCount: number;
} {
  const everySession = [
    fileTokens(path.join(HOME, ".claude", "CLAUDE.md"), "~/.claude/CLAUDE.md"),
    fileTokens(path.join(MEMORY_DIR, "MEMORY.md"), "memory/MEMORY.md (index)"),
  ].filter((f): f is AuditFile => f !== null);

  const perProject: AuditFile[] = [];
  let projects: fs.Dirent[] = [];
  try {
    projects = fs.readdirSync(CODE_DIR, { withFileTypes: true });
  } catch {
    // no ~/code
  }
  for (const dir of projects) {
    if (!dir.isDirectory()) continue;
    for (const name of ["CLAUDE.md", "AGENTS.md"]) {
      const f = fileTokens(
        path.join(CODE_DIR, dir.name, name),
        `${dir.name}/${name}`
      );
      if (f) perProject.push(f);
    }
  }
  perProject.sort((a, b) => b.tokens - a.tokens);

  const memory: MemoryEntry[] = [];
  const now = Date.now();
  let names: string[] = [];
  try {
    names = fs.readdirSync(MEMORY_DIR);
  } catch {
    // no memory dir
  }
  for (const name of names) {
    if (!name.endsWith(".md") || name === "MEMORY.md") continue;
    try {
      const text = fs.readFileSync(path.join(MEMORY_DIR, name), "utf8");
      const mtime = fs.statSync(path.join(MEMORY_DIR, name)).mtimeMs;
      const desc =
        text.match(/^description:\s*(.+)$/m)?.[1]?.replace(/^"|"$/g, "") ?? "";
      memory.push({
        name: name.slice(0, -3),
        description: desc.slice(0, 120),
        tokens: est(text),
        mtime,
        stale: now - mtime > STALE_MS,
        path: path.join(MEMORY_DIR, name),
      });
    } catch {
      // vanished mid-scan
    }
  }
  memory.sort((a, b) => b.tokens - a.tokens);

  return {
    everySession,
    perProject,
    memory,
    memoryTotalTokens: memory.reduce((s, m) => s + m.tokens, 0),
    staleCount: memory.filter((m) => m.stale).length,
  };
}
