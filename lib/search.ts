import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseTurns } from "./transcript";

// Full-text search over the two things HQ can see: transcripts
// (~/.claude/projects/**/*.jsonl, parsed into turns) and memory
// (~/.claude/projects/-Users-brendanstanton/memory/*.md). Substring/token
// match with a context snippet — embeddings later only if this falls short.

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const MEMORY_DIR = path.join(
  PROJECTS_ROOT,
  `-${os.homedir().slice(1).replaceAll("/", "-")}`,
  "memory"
);
const TAIL = 512 * 1024;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // transcript window — match Sessions
const MAX_FILES = 40;

export type SearchScope = "all" | "transcripts" | "memory";

export type SearchHit = {
  kind: "transcript" | "memory";
  /** transcript: session id (click pins the terminal); memory: file name */
  ref: string;
  title: string;
  snippet: string;
  at: number; // last-touched ms
  score: number;
};

export function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

// Total occurrences across all tokens; 0 unless EVERY token appears.
function scoreText(lower: string, toks: string[]): number {
  let total = 0;
  for (const t of toks) {
    let n = 0;
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + t.length))
      n++;
    if (n === 0) return 0;
    total += n;
  }
  return total;
}

// ~160 chars of context around the first hit of the first token.
function snippetAround(text: string, tok: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(tok);
  if (i === -1) return flat.slice(0, 160);
  const start = Math.max(0, i - 60);
  const end = Math.min(flat.length, i + tok.length + 100);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${
    end < flat.length ? "…" : ""
  }`;
}

// One hit per session: the most recent matching turn is the snippet, the score
// sums every matching turn so chattier sessions rank higher.
function searchTranscripts(toks: string[]): SearchHit[] {
  const now = Date.now();
  const files: { file: string; mtime: number }[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
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
        const mtime = fs.statSync(full).mtimeMs;
        if (now - mtime <= WINDOW_MS) files.push({ file: full, mtime });
      } catch {
        // vanished mid-scan
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  const hits: SearchHit[] = [];
  for (const { file, mtime } of files.slice(0, MAX_FILES)) {
    let text: string;
    let partial = false;
    try {
      const size = fs.statSync(file).size;
      const start = Math.max(0, size - TAIL);
      partial = start > 0;
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      text = buf.toString("utf8");
    } catch {
      continue;
    }
    const { turns, project } = parseTurns(text, partial);
    let score = 0;
    let snippet = "";
    for (const turn of turns) {
      const s = scoreText(turn.text.toLowerCase(), toks);
      if (s === 0) continue;
      score += s;
      snippet = snippetAround(turn.text, toks[0]); // later turns win
    }
    if (score === 0) continue;
    hits.push({
      kind: "transcript",
      ref: path.basename(file, ".jsonl"),
      title: project || path.basename(path.dirname(file)),
      snippet,
      at: mtime,
      score,
    });
  }
  return hits;
}

function searchMemory(toks: string[]): SearchHit[] {
  let names: string[];
  try {
    names = fs.readdirSync(MEMORY_DIR);
  } catch {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const name of names) {
    // skip the index — every memory would double as its MEMORY.md pointer
    if (!name.endsWith(".md") || name === "MEMORY.md") continue;
    const full = path.join(MEMORY_DIR, name);
    let content: string;
    let mtime: number;
    try {
      content = fs.readFileSync(full, "utf8");
      mtime = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    const score = scoreText(content.toLowerCase(), toks);
    if (score === 0) continue;
    hits.push({
      kind: "memory",
      ref: name,
      title: name.slice(0, -3),
      snippet: snippetAround(content, toks[0]),
      at: mtime,
      score,
    });
  }
  return hits;
}

export function search(
  query: string,
  scope: SearchScope = "all",
  limit = 30
): SearchHit[] {
  const toks = queryTokens(query);
  if (toks.length === 0) return [];
  const hits = [
    ...(scope !== "memory" ? searchTranscripts(toks) : []),
    ...(scope !== "transcripts" ? searchMemory(toks) : []),
  ];
  return hits.sort((a, b) => b.score - a.score || b.at - a.at).slice(0, limit);
}

// Full content of one memory file, for the result-click "open" view.
// Basename-only so a crafted ?open= can't walk out of the memory dir.
export function getMemoryFile(name: string): string | null {
  const base = path.basename(name);
  if (!base.endsWith(".md")) return null;
  try {
    return fs.readFileSync(path.join(MEMORY_DIR, base), "utf8");
  } catch {
    return null;
  }
}
