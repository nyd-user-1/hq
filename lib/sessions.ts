import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getUsage, perFileTotals, weighted } from "./usage";
import { baseCost } from "./pricing";
import { getSessionsMeta, type SessionsMeta } from "./sessions-meta";
import { projectsRoot } from "./config";
import { listChannels } from "./channel";

// Fleet view: every Claude Code session on this machine, from the same
// transcripts the token meter parses. Burn comes from the meter's file
// cache; project + last exchange come from a cheap tail read per file.

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const TAIL = 64 * 1024;
// "Active" = written to within the prompt-cache TTL (5 min) — green means
// "still cheap to continue", one definition of alive across the whole app.
const ACTIVE_MS = 5 * 60 * 1000;

export type SessionInfo = {
  id: string;
  project: string;
  lastActive: number;
  active: boolean;
  messages: number;
  weightedTokens: number;
  contextTokens: number; // current context size (last assistant entry's usage)
  cost: number; // estimated USD this session has cost (floor — see pricing.ts)
  snippet: string;
};

export function cleanText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tailInfo(file: string): {
  cwd: string | null;
  snippet: string;
  contextTokens: number;
} {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - TAIL);
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  const lines = buf.toString("utf8").split("\n");
  if (start > 0) lines.shift();

  let cwd: string | null = null;
  let snippet = "";
  let contextTokens = 0;
  for (const line of lines) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof e.cwd === "string") cwd = e.cwd;
    if (e.type !== "user" && e.type !== "assistant") continue;
    const u = e.type === "assistant" ? e.message?.usage : undefined;
    if (u)
      contextTokens =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.output_tokens ?? 0);
    const content = e.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((b: { type?: string }) => b?.type === "text")
              .map((b: { text?: string }) => b.text ?? "")
              .join(" ")
          : "";
    const cleaned = cleanText(text);
    if (cleaned) snippet = cleaned;
  }
  return { cwd, snippet, contextTokens };
}

// A lean "recent sessions" row for the sidebar Recents list (Claude-style).
// Title = the session's FIRST real user prompt (a head read), which reads like
// a conversation title; falls back to the project name.
export type RecentSession = {
  id: string;
  project: string;
  cwd: string | null; // the launch dir (absolute) — null when not recorded
  title: string;
  lastActive: number;
  active: boolean;
  live: boolean; // genuinely live RIGHT NOW (a connected channel) — a brighter, pulsing dot than merely-active
  entrypoint: string; // "cli" = interactive terminal; "sdk-cli" = Agent SDK run
  branch: string; // git branch at session time ("" when none / detached "HEAD")
  customTitle: string; // HQ rename (sidecar); "" when not renamed
  aiTitle: string; // Claude Code's auto-generated session title ("" if none yet)
  chainRoot: string; // root id of this session's /clear chain (self if none) — Tree grouping
  favorite: boolean; // pinned to the top of Recents
  hidden: boolean; // soft-deleted from Recents (toggle to reveal)
  archived: boolean; // moved to the browsable "Archived" group (still searchable)
  related: string[]; // cross-link tags (sidecar); [] when none
};

// THE PROJECT RULE: most sessions are launched from ~, so cwd is useless for
// the project — but the user opens (or early-on references) the project by path:
// "we're working in jane/code/hq", "/code/tariffs", "~/code/sports".
// This pulls the first such code/<slug> out of the USER text. cleanText strips
// <system-reminder> blocks first, so the injected memory index's many code/
// paths don't false-match. Reference the project as code/<slug> early and
// Recents sorts it accurately.
const PROJECT_REF = /(?:^|[\s/~"'(])code\/([a-z0-9][a-z0-9_-]*)/i;

// First path segment after .../code/ — the project slug when a session WAS
// launched inside its project dir (the authoritative signal when present).
function codeSlug(p: string): string | null {
  const m = p.match(/\/code\/([^/]+)/i); // case-insensitive: ~/Code and ~/code both count
  return m ? m[1] : null;
}

// Last-resort project from the transcript's projects-dir name (cwd "/"→"-"),
// e.g. "-Users-jane-code-44b" → "44b"; a plain home-dir session has
// no project signal on disk to recover, so it falls into "Unassigned" — a
// visible backlog of sessions that should be re-homed (set a project override).
function dirProject(file: string): string {
  const d = path.basename(path.dirname(file));
  const i = d.toLowerCase().indexOf("-code-"); // case-insensitive (-Code- counts)
  return i >= 0 ? d.slice(i + 6) : "Unassigned";
}

// Project + title for one transcript (head read), shared by Recents and the
// Archive so derivation is identical. mtime in, no stat here.
export function sessionMeta(
  file: string,
  mtime: number,
  meta: SessionsMeta = {}
): RecentSession {
  const { cwd, title, ref, entrypoint, branch, aiTitle } = headInfo(file);
  const id = path.basename(file, ".jsonl");
  const m = meta[id] ?? {};
  const derived =
    (cwd ? codeSlug(cwd) : null) ??
    ref ??
    (cwd && cwd !== os.homedir() ? path.basename(cwd) : dirProject(file));
  // A stored project override (sidecar) wins over derivation — the only way to
  // re-home a session launched from ~ that would otherwise derive to Unassigned.
  const project = m.project || derived;
  return {
    id,
    project,
    cwd,
    title: title || `${project} session`,
    lastActive: mtime,
    active: Date.now() - mtime < ACTIVE_MS,
    live: false, // transcript-derived; live-now tracking is for connected channel sessions
    entrypoint: entrypoint || "cli",
    // gitBranch is on most entries; "HEAD" (detached / non-branch) isn't worth
    // surfacing, so collapse it to empty.
    branch: branch && branch !== "HEAD" ? branch : "",
    aiTitle,
    chainRoot: id, // default: standalone; the /api/sessions route fills in real chains
    customTitle: m.title ?? "",
    favorite: !!m.favorite,
    hidden: !!m.hidden,
    archived: !!m.archived,
    related: m.related ?? [],
  };
}

// Reads the HEAD of a transcript (not the tail) for cwd, the opening prompt
// (title), and the first code/<slug> project reference.
function headInfo(file: string): {
  cwd: string | null;
  title: string;
  ref: string | null;
  entrypoint: string | null;
  branch: string | null;
  aiTitle: string;
} {
  let text: string;
  try {
    const fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 96 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return { cwd: null, title: "", ref: null, entrypoint: null, branch: null, aiTitle: "" };
  }

  let cwd: string | null = null;
  let title = "";
  let ref: string | null = null;
  let entrypoint: string | null = null;
  let branch: string | null = null;
  let aiTitle = ""; // Claude Code's own "ai-title" record (its conversation title)
  for (const line of text.split("\n")) {
    if (cwd && title && ref && entrypoint && aiTitle) break; // have everything
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof e.cwd === "string") cwd = e.cwd;
    if (!entrypoint && typeof e.entrypoint === "string") entrypoint = e.entrypoint;
    if (!branch && typeof e.gitBranch === "string") branch = e.gitBranch;
    // Claude Code writes its own conversation title as an "ai-title" record — the
    // same memorable name claude.ai shows. ~75% of sessions have one; reading it
    // (not generating it) keeps HQ pure-read. First one in the head wins.
    if (!aiTitle && e.type === "ai-title" && typeof e.aiTitle === "string") {
      const t = e.aiTitle.trim();
      if (t) aiTitle = t;
    }
    if (e.type !== "user" || e.isSidechain || e.isMeta) continue;
    const content = e.message?.content;
    const raw =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((b: { type?: string }) => b?.type === "text")
              .map((b: { text?: string }) => b.text ?? "")
              .join(" ")
          : "";
    // Skip slash-command / local-command records — not real prompts.
    if (!raw || /<command-(name|message)>|<local-command-stdout>/.test(raw))
      continue;
    const cleaned = cleanText(raw); // strips <system-reminder> + tags
    if (cleaned.length < 3) continue;
    if (!title) title = cleaned.slice(0, 90);
    if (!ref) {
      const m = cleaned.match(PROJECT_REF);
      if (m) ref = m[1].toLowerCase();
    }
  }
  return { cwd, title, ref, entrypoint, branch, aiTitle };
}

// Every transcript across all project dirs touched in the last 7 days, newest
// first — the shared scan behind both session readers below.
function recentFiles(): { file: string; mtime: number }[] {
  const now = Date.now();
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: { file: string; mtime: number }[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    let names: string[];
    try {
      names = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dirPath, f);
      try {
        const st = fs.statSync(full);
        if (st.size > 0 && now - st.mtimeMs <= 7 * 24 * 60 * 60 * 1000)
          files.push({ file: full, mtime: st.mtimeMs });
      } catch {
        // vanished mid-scan
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

// Newest sessions of one kind. Head-read in mtime order, stopping once `limit`
// matches are collected (so we don't head-read the whole machine). `kind`:
// "interactive" = real terminals (entrypoint "cli"), the Recents list; "sdk" =
// Agent SDK runs (entrypoint "sdk-cli"), kept out of Recents and shown in the
// Activity → SDK panel instead.
// Sessions HQ drives are spawned via `claude -p` (entrypoint "sdk-cli"), but
// they're real interactive sessions you steer — so they belong in Recents, not
// hidden as ephemeral SDK runs. lib/repl records their ids here.
function hqDrivenIds(): Set<string> {
  try {
    const raw = fs.readFileSync(
      path.join(os.homedir(), ".claude", "hq", "repl-sessions.json"),
      "utf8",
    );
    return new Set<string>(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

// A process is alive if signal-0 doesn't throw ESRCH (EPERM = alive, not ours).
function pidAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// LIVE channel-connected sessions (claude-hq), surfaced from their discovery files
// so a just-launched session is PINNABLE in the sidebar BEFORE it has a transcript
// — the first send then bootstraps the .jsonl via the channel. This mirrors how HQ
// knows a "+ new session" by its id at birth: for an external claude-hq session the
// discovery file IS that birth record (the REAL session id + cwd, written at launch).
// Only externally-launched discovery files carry a pid; HQ-spawned ones don't and
// already have transcripts — so the live-pid filter cleanly selects the transcript-
// less terminals we need to surface, and drops stale (crashed) discovery files.
function channelSessions(meta: SessionsMeta): RecentSession[] {
  const home = os.homedir();
  const out: RecentSession[] = [];
  for (const ch of listChannels()) {
    if (!ch.id || !pidAlive(ch.pid)) continue;
    const cwd = ch.cwd ?? null;
    const m = meta[ch.id] ?? {};
    const derived =
      (cwd ? codeSlug(cwd) : null) ??
      (cwd && cwd !== home ? path.basename(cwd) : "Unassigned");
    const project = m.project || derived;
    out.push({
      id: ch.id,
      project,
      cwd,
      title: m.title || `${project} session`,
      lastActive: (ch.startedAt ?? 0) * 1000 || Date.now(), // discovery startedAt is seconds
      active: true, // a live channel IS active
      live: true, // and live RIGHT NOW — the sidebar dot pulses bright
      entrypoint: "cli",
      branch: "",
      aiTitle: "",
      chainRoot: ch.id,
      customTitle: m.title ?? "",
      favorite: !!m.favorite,
      hidden: !!m.hidden,
      archived: !!m.archived,
      related: m.related ?? [],
    });
  }
  return out;
}

function sessionsOfKind(kind: "interactive" | "sdk", limit: number): RecentSession[] {
  const meta = getSessionsMeta();
  const driven = hqDrivenIds();
  const out: RecentSession[] = [];
  const seen = new Set<string>();
  for (const { file, mtime } of recentFiles()) {
    const m = sessionMeta(file, mtime, meta);
    // an HQ-driven session counts as interactive even though it's sdk-cli
    const isSdk = m.entrypoint === "sdk-cli" && !driven.has(m.id);
    if (kind === "sdk" ? !isSdk : isSdk) continue;
    out.push(m);
    seen.add(m.id);
    if (out.length >= limit) break;
  }
  // Surface LIVE channel sessions that have no transcript yet (interactive list
  // only), so a just-launched claude-hq session is pinnable from turn one. Dedup
  // against the file scan — one that already has a .jsonl keeps its richer entry.
  // Newest-first after the merge, then re-cap to the limit.
  if (kind === "interactive") {
    const extra = channelSessions(meta).filter((c) => !seen.has(c.id));
    if (extra.length) {
      out.push(...extra);
      out.sort((a, b) => b.lastActive - a.lastActive);
      return out.slice(0, limit);
    }
  }
  return out;
}

export function getRecentSessions(limit = 24): RecentSession[] {
  return sessionsOfKind("interactive", limit);
}

export function getSdkSessions(limit = 40): RecentSession[] {
  return sessionsOfKind("sdk", limit);
}

// The ~/code project folders — offered in the "+" new-session view so a session
// can be started IN its project (`cd ~/code/<name> && claude`). That sets the
// cwd, the authoritative project signal, so Recents sorts it with no text ref.
export function listCodeProjects(): string[] {
  const root = path.join(os.homedir(), "code");
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

// The launcher's project chips — folders you can start a NEW session in. Derived
// from where you ACTUALLY work (existing session cwds, existence-checked so moved/
// deleted folders drop out), unioned with whatever sits in your projectsRoot. This
// is the offline-first answer to "where are this user's projects?": read it from
// their own history instead of guessing a hardcoded path. Returns {name, path};
// the path is what the new-session route births into.
export function listLaunchProjects(): { name: string; path: string }[] {
  const home = os.homedir();
  const seen = new Map<string, { name: string; path: string; recency: number }>();
  // realpathSync canonicalizes case (a case-insensitive FS makes ~/Code and ~/code
  // the SAME folder) AND throws on a moved/deleted path — so it's both the dedup
  // key and the existence check in one (the ~/code-move lesson).
  const canon = (p: string): string | null => {
    try {
      // .native uses the OS realpath, which returns the TRUE on-disk casing on a
      // case-insensitive FS (the JS realpathSync preserves input case, so ~/code
      // and ~/Code would NOT dedupe). Falls back if .native is unavailable.
      return (fs.realpathSync.native ?? fs.realpathSync)(p);
    } catch {
      return null;
    }
  };
  // 1) folders from session history — the real, used set
  for (const s of getRecentSessions(1000)) {
    if (!s.cwd) continue;
    const c = canon(s.cwd);
    if (!c || c === home) continue;
    const hit = seen.get(c);
    if (hit) {
      hit.recency = Math.max(hit.recency, s.lastActive);
      continue;
    }
    seen.set(c, { name: path.basename(c), path: c, recency: s.lastActive });
  }
  // 2) folders sitting in the projects root — usable even before any session
  try {
    for (const d of fs.readdirSync(projectsRoot(), { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      const p = canon(path.join(projectsRoot(), d.name));
      if (p && !seen.has(p)) seen.set(p, { name: path.basename(p), path: p, recency: 0 });
    }
  } catch {
    /* root may not exist yet (created on first new-project) */
  }
  return [...seen.values()]
    .sort((a, b) => b.recency - a.recency || a.name.localeCompare(b.name))
    .map(({ name, path }) => ({ name, path }));
}

export function getSessions(limit = 12): SessionInfo[] {
  getUsage(); // refresh the meter's per-file cache
  const totals = perFileTotals();
  const meta = getSessionsMeta(); // honor the same project override as Recents
  const now = Date.now();

  const files: { file: string; mtime: number }[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return []; // no transcripts on this machine (e.g. deployed)
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    for (const f of fs.readdirSync(dirPath)) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dirPath, f);
      try {
        const mtime = fs.statSync(full).mtimeMs;
        if (now - mtime <= 7 * 24 * 60 * 60 * 1000) files.push({ file: full, mtime });
      } catch {
        // vanished mid-scan
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  return files.slice(0, limit).map(({ file, mtime }) => {
    const { cwd, snippet, contextTokens } = tailInfo(file);
    const t = totals.get(file);
    const id = path.basename(file, ".jsonl");
    const derived =
      cwd === os.homedir()
        ? "Unassigned"
        : cwd
          ? path.basename(cwd)
          : path.basename(path.dirname(file));
    return {
      id,
      project: meta[id]?.project || derived,
      lastActive: mtime,
      active: now - mtime < ACTIVE_MS,
      messages: t?.messages ?? 0,
      weightedTokens: t ? weighted(t) : 0,
      contextTokens,
      cost: t
        ? baseCost({
            model: t.model, // price at the session's real model, not always Opus (BUG-2)
            input: t.input,
            cacheCreate: t.cacheCreate,
            cacheRead: t.cacheRead,
            output: t.output,
          })
        : 0,
      snippet: snippet.slice(0, 120),
    };
  });
}
