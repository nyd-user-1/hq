import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Changelog: the same cross-project commits lib/shipped reads, but presented as a
// rich CARD TIMELINE instead of a flat row list. A Change carries what Shipped
// doesn't — the changed FILES (the file-chips are the whole point of the card) and
// a `claude` flag (did Claude co-author this change). Both are pulled in ONE
// `git log --name-only` per repo, not N getCommit() calls. Diff reading reuses
// lib/shipped's getCommit/findCommit. Local + fast; mirrors shipped's discovery.

const CODE_ROOT = path.join(os.homedir(), "code");
const FILE_CAP = 40; // a huge commit shouldn't bloat the feed payload

export type Change = {
  repo: string;
  sha: string; // short hash
  subject: string; // raw conventional-commit subject (the UI humanizes it)
  summary: string; // first paragraph of the body, trailers stripped, capped
  at: number; // committer time, ms
  files: string[]; // changed paths (capped at FILE_CAP)
  claude: boolean; // a Claude co-author / Claude-Session trailer is present
};

// Machine trailers HQ appends — never part of the human-readable summary.
const TRAILER_RE = /^(co-authored-by|claude-session|signed-off-by|claude-co-authored-by):/i;

// The first paragraph of the body with trailers + the 🤖 line removed, flattened.
function cleanSummary(body: string): string {
  const kept: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (kept.length) break; // stop at the first blank line after real content
      continue;
    }
    if (TRAILER_RE.test(line) || line.startsWith("🤖")) continue;
    kept.push(line);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim().slice(0, 200);
}

function isClaude(body: string): boolean {
  return /co-authored-by:[^\n]*claude/i.test(body) || /claude-session:/i.test(body);
}

// Short TTL cache — same rationale as shipped: commits don't move mid-view, and a
// git spawn per repo per render is wasteful.
let cache: { key: string; at: number; feed: Change[] } | null = null;
const TTL_MS = 5000;

export function getChangelog(limit = 60, perRepo = 20): Change[] {
  const key = `${limit}:${perRepo}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.feed;

  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(CODE_ROOT, { withFileTypes: true });
  } catch {
    return []; // no ~/code on this machine
  }

  const out: Change[] = [];
  const newestByRepo = new Map<string, Change>(); // first seen per repo = its newest
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const repo = d.name;
    const dir = path.join(CODE_ROOT, repo);
    if (!fs.existsSync(path.join(dir, ".git"))) continue; // .git dir OR worktree file
    let log: string;
    try {
      // \x01 begins each record, \x1f separates its fields, \x02 ends the
      // metadata; --name-only then lists the changed files (newline-separated)
      // until the next \x01. This survives a multi-line %b that line-based
      // parsing (or -z + --name-only's ambiguous field terminators) would mangle.
      log = execFileSync(
        "git",
        [
          "-C",
          dir,
          "log",
          "--no-merges",
          `-n${perRepo}`,
          "--name-only",
          "--pretty=format:%x01%H%x1f%ct%x1f%s%x1f%b%x02",
        ],
        {
          encoding: "utf8",
          timeout: 4000,
          maxBuffer: 8 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
    } catch {
      continue; // not a repo / no commits / git unavailable
    }

    for (const block of log.split("\x01")) {
      if (!block) continue;
      const end = block.indexOf("\x02");
      if (end === -1) continue;
      const meta = block.slice(0, end).split("\x1f");
      if (meta.length < 3) continue;
      const sha = meta[0];
      const ct = Number(meta[1]);
      if (!Number.isFinite(ct)) continue;
      const subject = meta[2] ?? "";
      const body = meta[3] ?? "";
      const files = block
        .slice(end + 1)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const change: Change = {
        repo,
        sha: sha.slice(0, 7),
        subject,
        summary: cleanSummary(body),
        at: ct * 1000,
        files: files.slice(0, FILE_CAP),
        claude: isClaude(body),
      };
      out.push(change);
      if (!newestByRepo.has(repo)) newestByRepo.set(repo, change);
    }
  }

  out.sort((a, b) => b.at - a.at);
  const feed = out.slice(0, limit);
  // Coverage: every repo's newest change appears even if older than the cutoff.
  const covered = new Set(feed.map((c) => c.repo));
  for (const [repo, c] of newestByRepo) if (!covered.has(repo)) feed.push(c);
  feed.sort((a, b) => b.at - a.at);

  cache = { key, at: Date.now(), feed };
  return feed;
}
