import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getUsage, perFileTotals, weighted } from "./usage";

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
  snippet: string;
};

function cleanText(text: string): string {
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
  title: string;
  lastActive: number;
  active: boolean;
};

// Reads the HEAD of a transcript (not the tail) for cwd + the opening prompt.
function headInfo(file: string): { cwd: string | null; title: string } {
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
    return { cwd: null, title: "" };
  }

  let cwd: string | null = null;
  let title = "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof e.cwd === "string") cwd = e.cwd;
    if (title) {
      if (cwd) break; // have both — stop
      continue;
    }
    // First non-command, non-meta user prompt = the title.
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
    const cleaned = cleanText(raw);
    if (cleaned.length < 3) continue;
    title = cleaned.slice(0, 90);
  }
  return { cwd, title };
}

export function getRecentSessions(limit = 24): RecentSession[] {
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

  return files.slice(0, limit).map(({ file, mtime }) => {
    const { cwd, title } = headInfo(file);
    const project =
      cwd === os.homedir()
        ? "~ (home)"
        : cwd
          ? path.basename(cwd)
          : path.basename(path.dirname(file));
    return {
      id: path.basename(file, ".jsonl"),
      project,
      title: title || `${project} session`,
      lastActive: mtime,
      active: now - mtime < ACTIVE_MS,
    };
  });
}

export function getSessions(limit = 12): SessionInfo[] {
  getUsage(); // refresh the meter's per-file cache
  const totals = perFileTotals();
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
    return {
      id: path.basename(file, ".jsonl"),
      project:
        cwd === os.homedir()
          ? "~ (home)"
          : cwd
            ? path.basename(cwd)
            : path.basename(path.dirname(file)),
      lastActive: mtime,
      active: now - mtime < ACTIVE_MS,
      messages: t?.messages ?? 0,
      weightedTokens: t ? weighted(t) : 0,
      contextTokens,
      snippet: snippet.slice(0, 120),
    };
  });
}
