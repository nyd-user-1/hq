import { execFileSync } from "node:child_process";

// Issues: the hq repo's GitHub Issues, read straight off the `gh` CLI — no DB, no
// API token plumbing, just shelling out to the tool the user already has authed.
// Mirrors lib/changelog's shape: a pure reader (getIssues) + a short TTL cache,
// plus a single WRITE (createIssue) that files a new issue. Every arg is passed as
// argv to execFileSync — NEVER string-interpolated into a shell — so a title/body
// with backticks, quotes, or `; rm -rf` is inert data, not a command.

const REPO = "nyd-user-1/hq";

// The launchd dev server inherits a minimal PATH that lacks /opt/homebrew/bin,
// so a bare `gh` spawn there fails with ENOENT (this IS the repl-daemon env-leak,
// issue #2 — fixed broadly in M5). Augment PATH for our own spawns so the Issues
// panel works regardless of how the server was launched.
const GH_ENV = {
  ...process.env,
  PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin`,
};

export type Issue = {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  labels: { name: string }[];
  url: string;
  createdAt: string;
  updatedAt: string;
  body: string;
};

// Short TTL cache — same rationale as changelog: issues don't move mid-view and a
// `gh` spawn per render is wasteful. Invalidated on createIssue so a freshly filed
// issue shows up on the next list.
let cache: { at: number; issues: Issue[] } | null = null;
const TTL_MS = 5000;

export function getIssues(): Issue[] {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.issues;

  let raw: string;
  try {
    raw = execFileSync(
      "gh",
      [
        "issue",
        "list",
        "--repo",
        REPO,
        "--state",
        "all",
        "--limit",
        "50",
        "--json",
        "number,title,state,labels,url,createdAt,updatedAt,body",
      ],
      {
        encoding: "utf8",
        timeout: 8000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        env: GH_ENV,
      },
    );
  } catch {
    return []; // gh not installed / not authed / network down
  }

  let issues: Issue[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    issues = Array.isArray(parsed) ? (parsed as Issue[]) : [];
  } catch {
    return []; // unexpected gh output
  }

  cache = { at: Date.now(), issues };
  return issues;
}

// File a new issue. Returns the created issue's URL (gh prints it on stdout). Args
// are argv — title/body are never interpolated into a shell.
export function createIssue(
  title: string,
  body: string,
): { ok: boolean; url?: string; error?: string } {
  const t = (title ?? "").trim();
  if (!t) return { ok: false, error: "title required" };

  try {
    const out = execFileSync(
      "gh",
      ["issue", "create", "--repo", REPO, "--title", t, "--body", body ?? ""],
      {
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        env: GH_ENV,
      },
    );
    // gh prints the new issue's URL on stdout (last non-empty line).
    const url = out
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .pop();
    cache = null; // invalidate so the next list reflects the new issue
    return { ok: true, url };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const stderr = err?.stderr ? String(err.stderr).trim() : "";
    return { ok: false, error: stderr || err?.message || "gh issue create failed" };
  }
}
