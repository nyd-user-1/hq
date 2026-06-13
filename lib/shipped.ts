import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Shipped: a cross-project commit feed. Reads `git log` from every repo under
// ~/code and merges them newest-first, so HQ can answer "what got shipped, where,
// when" across all projects at a glance — instead of being blind to its own
// output. Local + fast (one `git log` per repo, capped).

const CODE_ROOT = path.join(os.homedir(), "code");

export type Ship = {
  repo: string;
  sha: string; // short hash
  subject: string;
  at: number; // committer time, ms
};

export function getShipped(limit = 40, perRepo = 15): Ship[] {
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(CODE_ROOT, { withFileTypes: true });
  } catch {
    return []; // no ~/code on this machine
  }

  const out: Ship[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const repo = d.name;
    const dir = path.join(CODE_ROOT, repo);
    if (!fs.existsSync(path.join(dir, ".git"))) continue; // dir or file (worktree)
    let log: string;
    try {
      log = execFileSync(
        "git",
        ["-C", dir, "log", `-n${perRepo}`, "--pretty=format:%H%x09%ct%x09%s"],
        { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }
      );
    } catch {
      continue; // not a repo / no commits / git unavailable
    }
    for (const line of log.split("\n")) {
      if (!line) continue;
      const t1 = line.indexOf("\t");
      const t2 = line.indexOf("\t", t1 + 1);
      if (t1 === -1 || t2 === -1) continue;
      const ct = Number(line.slice(t1 + 1, t2));
      if (!Number.isFinite(ct)) continue;
      out.push({
        repo,
        sha: line.slice(0, t1).slice(0, 7),
        subject: line.slice(t2 + 1),
        at: ct * 1000,
      });
    }
  }

  out.sort((a, b) => b.at - a.at);
  return out.slice(0, limit);
}

const SHA_RE = /^[0-9a-f]{7,40}$/i;

// The full commit (message + diffstat + patch) for the in-panel reader. Both
// args come from the URL, so they're validated: `repo` must be a real dir under
// ~/code (basename only, no traversal) and `sha` must be hex — then execFile's
// array args can't be shell-injected.
export function getCommit(
  repo: string,
  sha: string
): { repo: string; sha: string; text: string } | null {
  if (!SHA_RE.test(sha)) return null;
  const base = path.basename(repo);
  if (base !== repo) return null;
  const dir = path.join(CODE_ROOT, base);
  try {
    if (!fs.existsSync(path.join(dir, ".git"))) return null;
  } catch {
    return null;
  }
  let text: string;
  try {
    text = execFileSync(
      "git",
      ["-C", dir, "show", "--no-color", "--stat", "--patch", sha],
      {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
  } catch {
    return null; // unknown sha / git error
  }
  const lines = text.split("\n");
  if (lines.length > 800)
    text = lines.slice(0, 800).join("\n") + "\n… (truncated)";
  return { repo: base, sha, text };
}
