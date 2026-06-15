import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scoreNorm, snippetAround, normalize } from "./text-search";
import {
  searchTranscriptIndex,
  getArchiveSessions,
  warmIndex,
} from "./archive";
import { NOTES_DIR, noteTitle } from "./notes";

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
// Repo automation scripts (scripts/*.mjs etc.). process.cwd() is the repo root
// for the Next server — the same assumption lib/archive.ts makes for BUILD_SCRIPT.
const SCRIPTS_DIR = path.join(process.cwd(), "scripts");
const SCRIPT_EXTS = [".mjs", ".js", ".cjs", ".ts", ".sh", ".py"];
const isScript = (name: string) => SCRIPT_EXTS.some((e) => name.endsWith(e));

export type SearchScope =
  | "all"
  | "transcripts"
  | "memory"
  | "notes"
  | "scripts";
export type SortDir = "new" | "old"; // result order: newest-first (default) / oldest-first

export type SearchHit = {
  kind: "transcript" | "memory" | "note" | "script";
  /** transcript: session id (click pins the terminal); memory/note/script: file name */
  ref: string;
  title: string;
  snippet: string;
  at: number; // last-touched ms
  score: number;
  phrase: boolean; // true = contiguous-phrase hit (the narrowing tier)
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
      phrase: h.phrase,
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
    const mt = scoreNorm(normalize(content), toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "memory",
      ref: name,
      title: name.slice(0, -3),
      snippet: snippetAround(content, toks[0]),
      at: mtime,
      score: mt.score,
      phrase: mt.phrase,
    });
  }
  return hits;
}

// Saved note blocks (~/.claude/hq/notes/*.md) — same substring/token read as
// memory. Title is the note's first body line (the filename is a timestamp).
function searchNotes(toks: string[]): SearchHit[] {
  let names: string[];
  try {
    names = fs.readdirSync(NOTES_DIR);
  } catch {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const full = path.join(NOTES_DIR, name);
    let content: string;
    let mtime: number;
    try {
      content = fs.readFileSync(full, "utf8");
      mtime = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    const mt = scoreNorm(normalize(content), toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "note",
      ref: name,
      title: noteTitle(content),
      snippet: snippetAround(content, toks[0]),
      at: mtime,
      score: mt.score,
      phrase: mt.phrase,
    });
  }
  return hits;
}

// Repo automation scripts (scripts/*.{mjs,js,sh,…}) — same substring/token read
// as memory/notes; a handful of small files, so no persisted index needed. Title
// is the bare filename; clicking opens the source, dragging drops the path.
function searchScripts(toks: string[]): SearchHit[] {
  let names: string[];
  try {
    names = fs.readdirSync(SCRIPTS_DIR);
  } catch {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const name of names) {
    if (!isScript(name)) continue;
    const full = path.join(SCRIPTS_DIR, name);
    let content: string;
    let mtime: number;
    try {
      content = fs.readFileSync(full, "utf8");
      mtime = fs.statSync(full).mtimeMs;
    } catch {
      continue;
    }
    const mt = scoreNorm(normalize(content), toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "script",
      ref: name,
      title: name,
      snippet: snippetAround(content, toks[0]),
      at: mtime,
      score: mt.score,
      phrase: mt.phrase,
    });
  }
  return hits;
}

export function search(
  query: string,
  scope: SearchScope = "all",
  sort: SortDir = "new",
  limit = 40
): { hits: SearchHit[]; building: boolean } {
  // Keep the all-time index fresh (build if missing / a session changed). Cheap
  // + deduped; the first-ever build runs out-of-process and flags `building`.
  warmIndex();

  const toks = queryTokens(query);
  if (toks.length === 0) return { hits: [], building: false };

  const t =
    scope === "all" || scope === "transcripts"
      ? searchTranscripts(toks)
      : { hits: [] as SearchHit[], building: false };
  const m = scope === "all" || scope === "memory" ? searchMemory(toks) : [];
  const n = scope === "all" || scope === "notes" ? searchNotes(toks) : [];
  const s = scope === "all" || scope === "scripts" ? searchScripts(toks) : [];

  // Phrase is a hard tier: if the contiguous phrase matched anywhere, show ONLY
  // phrase hits — searching a full phrase is a NARROWING act (find the needle),
  // so scattered-term cards are noise. AND-of-tokens results survive only when
  // the phrase appears nowhere (e.g. two words never adjacent).
  const all = [...t.hits, ...m, ...n, ...s];
  const anyPhrase = all.some((h) => h.phrase);
  // Default newest-first; the UI toggle flips to oldest-first (so the ORIGINAL
  // occurrence of a phrase rises to the top). Recency is primary; score breaks
  // ties (effectively never, since `at` is ms).
  const dir = sort === "old" ? 1 : -1;
  const hits = (anyPhrase ? all.filter((h) => h.phrase) : all)
    .sort((a, b) => dir * (a.at - b.at) || b.score - a.score)
    .slice(0, limit);
  return { hits, building: t.building };
}

// One-line description of a memory note: its frontmatter `description:`, else
// the first non-frontmatter line. For the empty-state recents snippet.
function memoryDescription(content: string): string {
  const d = content.match(/^description:\s*(.+)$/m);
  if (d) return d[1].replace(/^["']|["']$/g, "").trim();
  const body = content.replace(/^---[\s\S]*?---\n/, "");
  return (body.split("\n").find((l) => l.trim()) || "").slice(0, 160);
}

// One-line description of a script: its first comment line (//, #, or /*),
// skipping a shebang — for the empty-state recents snippet.
function scriptDescription(content: string): string {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#!")) continue; // skip blanks + shebang
    const m = line.match(/^(?:\/\/+|#+|\/\*+)\s*(.*?)\s*(?:\*\/)?$/);
    return m ? m[1].slice(0, 160) : ""; // first real line: comment → text, code → none
  }
  return "";
}

// The empty-state browse: most-recent transcripts + memory notes as cards (no
// query). Same shape as search hits so the page renders them identically;
// honors the scope chips and the newest/oldest sort toggle.
export function recent(
  scope: SearchScope = "all",
  sort: SortDir = "new",
  limit = 40
): SearchHit[] {
  const out: SearchHit[] = [];
  if (scope === "all" || scope === "transcripts") {
    for (const s of getArchiveSessions()) {
      const title = s.project && s.project !== "~" ? s.project : s.title || s.id.slice(0, 8);
      out.push({ kind: "transcript", ref: s.id, title, snippet: s.title || "", at: s.lastActive, score: 0, phrase: false });
    }
  }
  if (scope === "all" || scope === "memory") {
    let names: string[] = [];
    try { names = fs.readdirSync(MEMORY_DIR); } catch { names = []; }
    for (const name of names) {
      if (!name.endsWith(".md") || name === "MEMORY.md") continue;
      const full = path.join(MEMORY_DIR, name);
      try {
        out.push({
          kind: "memory",
          ref: name,
          title: name.slice(0, -3),
          snippet: memoryDescription(fs.readFileSync(full, "utf8")),
          at: fs.statSync(full).mtimeMs,
          score: 0,
          phrase: false,
        });
      } catch {
        // file vanished mid-read
      }
    }
  }
  if (scope === "all" || scope === "notes") {
    let names: string[] = [];
    try { names = fs.readdirSync(NOTES_DIR); } catch { names = []; }
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      const full = path.join(NOTES_DIR, name);
      try {
        const content = fs.readFileSync(full, "utf8");
        out.push({
          kind: "note",
          ref: name,
          title: noteTitle(content),
          snippet: noteTitle(content),
          at: fs.statSync(full).mtimeMs,
          score: 0,
          phrase: false,
        });
      } catch {
        // file vanished mid-read
      }
    }
  }
  if (scope === "all" || scope === "scripts") {
    let names: string[] = [];
    try {
      names = fs.readdirSync(SCRIPTS_DIR);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!isScript(name)) continue;
      const full = path.join(SCRIPTS_DIR, name);
      try {
        out.push({
          kind: "script",
          ref: name,
          title: name,
          snippet: scriptDescription(fs.readFileSync(full, "utf8")),
          at: fs.statSync(full).mtimeMs,
          score: 0,
          phrase: false,
        });
      } catch {
        // file vanished mid-read
      }
    }
  }
  const dir = sort === "old" ? 1 : -1;
  return out.sort((a, b) => dir * (a.at - b.at)).slice(0, limit);
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

// Absolute path of a script file — for the reader's click-to-copy path header
// and the drag-into-terminal payload. Basename-only (no dir-walk).
export function scriptFilePath(name: string): string {
  return path.join(SCRIPTS_DIR, path.basename(name));
}

// Full source of one script file, for the result-click "open" view.
// Basename-only so a crafted ?open= can't walk out of the scripts dir.
export function getScriptFile(name: string): string | null {
  const base = path.basename(name);
  if (!isScript(base)) return null;
  try {
    return fs.readFileSync(path.join(SCRIPTS_DIR, base), "utf8");
  } catch {
    return null;
  }
}
