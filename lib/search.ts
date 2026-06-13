import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scoreNorm, snippetAround, normalize } from "./text-search";
import {
  searchTranscriptIndex,
  getArchiveSessions,
  warmIndex,
} from "./archive";

// Full-text search over the two things HQ can see: transcripts (EVERY session
// ever, via the all-time persisted index in lib/archive.ts) and memory
// (~/.claude/projects/-Users-brendanstanton/memory/*.md). Substring/token match
// with a context snippet, ranked by occurrence count.

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const MEMORY_DIR = path.join(
  PROJECTS_ROOT,
  `-${os.homedir().slice(1).replaceAll("/", "-")}`,
  "memory"
);

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

// Normalized query tokens: lowercase, split on any non-alphanumeric run, so
// punctuation in the query ("wow..you did it.") never glues words together or
// gets matched literally. The single-spaced join of these IS the search phrase.
export function queryTokens(query: string): string[] {
  return normalize(query).split(" ").filter(Boolean);
}

// Transcripts: hits come from the all-time index (id + score + snippet); titles
// and timestamps come from the browse metadata. Naming mirrors the rest of the
// app — project name, falling back to the first prompt for home (~) sessions.
function searchTranscripts(toks: string[]): { hits: SearchHit[]; building: boolean } {
  const { hits: idxHits, building } = searchTranscriptIndex(toks);
  if (idxHits.length === 0) return { hits: [], building };

  const meta = new Map(getArchiveSessions().map((s) => [s.id, s]));
  const hits: SearchHit[] = [];
  for (const h of idxHits) {
    const m = meta.get(h.id);
    if (!m) continue; // indexed file no longer present
    const title =
      m.project && m.project !== "~" ? m.project : m.title || h.id.slice(0, 8);
    hits.push({
      kind: "transcript",
      ref: h.id,
      title,
      snippet: h.snippet,
      at: m.lastActive,
      score: h.score,
    });
  }
  return { hits, building };
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
    const score = scoreNorm(normalize(content), toks);
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
  limit = 40
): { hits: SearchHit[]; building: boolean } {
  // Keep the all-time index fresh (build if missing / a session changed). Cheap
  // + deduped; the first-ever build runs out-of-process and flags `building`.
  warmIndex();

  const toks = queryTokens(query);
  if (toks.length === 0) return { hits: [], building: false };

  const t =
    scope !== "memory"
      ? searchTranscripts(toks)
      : { hits: [] as SearchHit[], building: false };
  const m = scope !== "transcripts" ? searchMemory(toks) : [];

  const hits = [...t.hits, ...m]
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, limit);
  return { hits, building: t.building };
}

// Absolute path of a memory file — for the reader's click-to-copy path header.
export function memoryFilePath(name: string): string {
  return path.join(MEMORY_DIR, path.basename(name));
}

// Corpus scale, for the empty-state "N sessions · M memory notes" line.
export function corpusCounts(): { sessions: number; memory: number } {
  let memory = 0;
  try {
    memory = fs
      .readdirSync(MEMORY_DIR)
      .filter((n) => n.endsWith(".md") && n !== "MEMORY.md").length;
  } catch {
    // no memory dir
  }
  let sessions = 0;
  try {
    sessions = getArchiveSessions().length;
  } catch {
    // no transcripts
  }
  return { sessions, memory };
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
