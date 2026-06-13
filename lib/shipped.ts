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
  body: string; // commit body, flattened to one line (the card snippet)
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
  const newestByRepo = new Map<string, Ship>(); // first seen per repo = its newest
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const repo = d.name;
    const dir = path.join(CODE_ROOT, repo);
    if (!fs.existsSync(path.join(dir, ".git"))) continue; // dir or file (worktree)
    let log: string;
    try {
      // -z = NUL-separated records, so a multi-line commit body (%b) stays in
      // its own record instead of breaking line-based parsing.
      log = execFileSync(
        "git",
        [
          "-C",
          dir,
          "log",
          "-z",
          `-n${perRepo}`,
          "--pretty=format:%H%x09%ct%x09%s%x09%b",
        ],
        { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }
      );
    } catch {
      continue; // not a repo / no commits / git unavailable
    }
    for (const rec of log.split("\0")) {
      if (!rec) continue;
      const t1 = rec.indexOf("\t");
      const t2 = rec.indexOf("\t", t1 + 1);
      const t3 = rec.indexOf("\t", t2 + 1);
      if (t1 === -1 || t2 === -1 || t3 === -1) continue;
      const ct = Number(rec.slice(t1 + 1, t2));
      if (!Number.isFinite(ct)) continue;
      const ship: Ship = {
        repo,
        sha: rec.slice(0, t1).slice(0, 7),
        subject: rec.slice(t2 + 1, t3),
        body: rec.slice(t3 + 1).replace(/\s+/g, " ").trim().slice(0, 240),
        at: ct * 1000,
      };
      out.push(ship);
      if (!newestByRepo.has(repo)) newestByRepo.set(repo, ship);
    }
  }

  out.sort((a, b) => b.at - a.at);
  const feed = out.slice(0, limit);
  // Coverage: every repo's newest commit appears, even if it's old enough to
  // fall outside the top `limit` — so no project is ever invisible.
  const covered = new Set(feed.map((s) => s.repo));
  for (const [repo, ship] of newestByRepo) {
    if (!covered.has(repo)) feed.push(ship);
  }
  feed.sort((a, b) => b.at - a.at);
  return feed;
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

// Resolve a sha with NO repo (the chat-window links carry only the hash) by
// trying each ~/code repo until one has the commit. Shas are ~unique, so the
// first hit is the right one.
export function findCommit(
  sha: string
): { repo: string; sha: string; text: string } | null {
  if (!SHA_RE.test(sha)) return null;
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(CODE_ROOT, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const c = getCommit(d.name, sha);
    if (c) return c;
  }
  return null;
}
