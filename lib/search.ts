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
import { getRecentSessions, getSdkSessions, type RecentSession } from "./sessions";
import { getShipped, type Ship } from "./shipped";
import { getTodos } from "./todo";
import { getProjects } from "./projects";
import { getSkills } from "./skills";
import { getFiles } from "./files";
import { COMPONENTS, REGISTRY_CREATED_AT } from "./components";

// Universal search over everything HQ can see. Two flavors of corpus:
//  • CONTENT — full text of the thing (transcripts via the persisted index;
//    memory / notes / scripts read live).
//  • METADATA — the thing's identity, not its body (sessions/sdk by title +
//    project + branch; files by path; components by name + desc; commits by
//    message; todos by text + body; projects by name; skills by name + desc).
// "transcripts" (conversation body) and "sessions" (session identity) are
// deliberately separate scopes — a different search, honestly labelled.
// Substring/token match with a context snippet, ranked newest-first.

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
  | "sessions"
  | "sdk"
  | "files"
  | "components"
  | "commits"
  | "todos"
  | "projects"
  | "memory"
  | "notes"
  | "scripts"
  | "skills";

export type SearchKind =
  | "transcript"
  | "session"
  | "sdk"
  | "file"
  | "component"
  | "commit"
  | "todo"
  | "project"
  | "memory"
  | "note"
  | "script"
  | "skill";

// All scopes except the "all" umbrella — the literal source for the chip row +
// the param validator, so adding a corpus is one edit here, not three.
export const SCOPES: { value: SearchScope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sessions", label: "Sessions" },
  { value: "transcripts", label: "Transcripts" },
  { value: "sdk", label: "SDK" },
  { value: "files", label: "Files" },
  { value: "components", label: "Components" },
  { value: "commits", label: "Commits" },
  { value: "todos", label: "Todos" },
  { value: "projects", label: "Projects" },
  { value: "notes", label: "Notes" },
  { value: "memory", label: "Memory" },
  { value: "scripts", label: "Scripts" },
  { value: "skills", label: "Skills" },
];

export type SortDir = "new" | "old"; // result order: newest-first (default) / oldest-first

export type SearchHit = {
  kind: SearchKind;
  /** the click target — transcript/session/sdk: session id; file: repo-rel path;
   * component: name; commit: repo/sha; todo: id; project: name; skill: SKILL.md
   * path; memory/note/script: file name */
  ref: string;
  title: string;
  snippet: string;
  at: number; // last-touched ms
  score: number;
  phrase: boolean; // true = contiguous-phrase hit (the narrowing tier)
  path?: string; // file path for the footer (file/component/script/skill); click-to-copy
  meta?: string; // small footer descriptor (ext · project · repo · category · /skill)
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

// score one metadata string (vs. a whole document) against the query tokens.
const sc = (text: string, toks: string[]) => scoreNorm(normalize(text), toks);

// Sessions / SDK — match a session by its IDENTITY (title · project · branch ·
// id), not its transcript body (that's the "transcripts" scope). `kind` keeps
// the two honest. Click opens the transcript reader (same as a transcript hit).
function searchSessionRows(
  rows: RecentSession[],
  kind: "session" | "sdk",
  toks: string[]
): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const s of rows) {
    const title = s.customTitle || s.title || s.project;
    const mt = sc([title, s.project, s.branch, s.id].filter(Boolean).join(" "), toks);
    if (mt.score === 0) continue;
    hits.push({
      kind,
      ref: s.id,
      title,
      snippet: `${s.project}${s.branch ? " · " + s.branch : ""}`,
      at: s.lastActive,
      score: mt.score,
      phrase: mt.phrase,
      meta: s.project,
    });
  }
  return hits;
}

// Files — match a file by its repo-relative PATH (name + dirs + ext). v1 is
// name/path search; full content grep is the deferred v2. normalize() splits
// "planner-panel.tsx" → "planner panel tsx", so "planner", "tsx", or the phrase
// "planner panel" all hit.
function searchFilesCorpus(toks: string[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const f of getFiles()) {
    const mt = sc(f.rel, toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "file",
      ref: f.rel,
      title: f.name,
      snippet: f.rel,
      at: f.mtime,
      score: mt.score,
      phrase: mt.phrase,
      path: f.rel,
      meta: f.ext ? "." + f.ext : "",
    });
  }
  return hits;
}

// Components — match the registry by name + description + file (NOT source; that
// rides with the deferred file-content v2). Click opens the component source.
function searchComponentsCorpus(toks: string[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const c of COMPONENTS) {
    const mt = sc(`${c.name} ${c.desc} ${c.file}`, toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "component",
      ref: c.name,
      title: c.name,
      snippet: c.desc,
      at: REGISTRY_CREATED_AT,
      score: mt.score,
      phrase: mt.phrase,
      path: c.file,
      meta: c.status,
    });
  }
  return hits;
}

// Commits — `git log` across ~/code is the one expensive read here (~1-2s), so
// memoize it: a 10s in-process TTL covers a burst of searches without re-shelling.
let shippedCache: { at: number; ships: Ship[] } | null = null;
function cachedShipped(): Ship[] {
  const now = Date.now();
  if (shippedCache && now - shippedCache.at < 10000) return shippedCache.ships;
  const ships = getShipped(200, 30);
  shippedCache = { at: now, ships };
  return ships;
}

function searchCommits(toks: string[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const s of cachedShipped()) {
    const mt = sc(`${s.subject} ${s.body}`, toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "commit",
      ref: `${s.repo}/${s.sha}`,
      title: s.subject,
      snippet: s.body || s.subject,
      at: s.at,
      score: mt.score,
      phrase: mt.phrase,
      meta: s.repo,
    });
  }
  return hits;
}

// Todos — top-level only (sub-items are noise here). Match text + body + tags.
function searchTodos(toks: string[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const t of getTodos()) {
    if (t.parentId) continue;
    const cats = (t.categories ?? []).join(" ");
    const mt = sc(`${t.text} ${t.body ?? ""} ${t.category ?? ""} ${cats}`, toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "todo",
      ref: t.id,
      title: t.text,
      snippet: t.body ? snippetAround(t.body, toks[0]) : t.done ? "done" : "open",
      at: t.createdAt,
      score: mt.score,
      phrase: mt.phrase,
      meta: t.done ? "done" : t.category ?? "open",
    });
  }
  return hits;
}

// Projects — match the derived project name. Click lists the project's sessions.
function searchProjects(toks: string[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const p of getProjects()) {
    const mt = sc(p.name, toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "project",
      ref: p.name,
      title: p.name,
      snippet: `${p.sessions} session${p.sessions === 1 ? "" : "s"}`,
      at: p.lastActive,
      score: mt.score,
      phrase: mt.phrase,
      meta: `${p.sessions}`,
    });
  }
  return hits;
}

// Skills — match name + title + description + arg hint. Click opens SKILL.md.
function searchSkills(toks: string[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const k of getSkills()) {
    const mt = sc(`${k.name} ${k.title} ${k.description} ${k.argHint}`, toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "skill",
      ref: k.path,
      title: k.title,
      snippet: k.description || `/${k.name}`,
      at: k.mtime,
      score: mt.score,
      phrase: mt.phrase,
      path: k.path,
      meta: `/${k.name}`,
    });
  }
  return hits;
}

// A session as a zero-score recent card (the empty-state browse).
function sessionRecent(s: RecentSession, kind: "session" | "sdk"): SearchHit {
  return {
    kind,
    ref: s.id,
    title: s.customTitle || s.title || s.project,
    snippet: `${s.project}${s.branch ? " · " + s.branch : ""}`,
    at: s.lastActive,
    score: 0,
    phrase: false,
    meta: s.project,
  };
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
  const sess =
    scope === "all" || scope === "sessions"
      ? searchSessionRows(getRecentSessions(1000), "session", toks)
      : [];
  const sdk =
    scope === "all" || scope === "sdk"
      ? searchSessionRows(getSdkSessions(200), "sdk", toks)
      : [];
  const fil = scope === "all" || scope === "files" ? searchFilesCorpus(toks) : [];
  const comp = scope === "all" || scope === "components" ? searchComponentsCorpus(toks) : [];
  const com = scope === "all" || scope === "commits" ? searchCommits(toks) : [];
  const td = scope === "all" || scope === "todos" ? searchTodos(toks) : [];
  const proj = scope === "all" || scope === "projects" ? searchProjects(toks) : [];
  const sk = scope === "all" || scope === "skills" ? searchSkills(toks) : [];

  // Phrase is a hard tier: if the contiguous phrase matched anywhere, show ONLY
  // phrase hits — searching a full phrase is a NARROWING act (find the needle),
  // so scattered-term cards are noise. AND-of-tokens results survive only when
  // the phrase appears nowhere (e.g. two words never adjacent).
  const all = [
    ...t.hits, ...m, ...n, ...s,
    ...sess, ...sdk, ...fil, ...comp, ...com, ...td, ...proj, ...sk,
  ];
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
  // Time-meaningful corpora join the default "all" browse; reference corpora
  // (files/components/projects/skills) surface only when their scope is picked,
  // so the empty state stays a recency feed, not a registry dump.
  if (scope === "all" || scope === "sessions")
    for (const s of getRecentSessions(40)) out.push(sessionRecent(s, "session"));
  if (scope === "all" || scope === "sdk")
    for (const s of getSdkSessions(40)) out.push(sessionRecent(s, "sdk"));
  if (scope === "all" || scope === "todos")
    for (const t of getTodos()) {
      if (t.parentId) continue;
      out.push({
        kind: "todo",
        ref: t.id,
        title: t.text,
        snippet: t.body
          ? t.body.split("\n").find((l) => l.trim()) ?? ""
          : t.done
            ? "done"
            : "open",
        at: t.createdAt,
        score: 0,
        phrase: false,
        meta: t.done ? "done" : t.category ?? "open",
      });
    }
  if (scope === "all" || scope === "commits")
    for (const s of cachedShipped().slice(0, 40))
      out.push({
        kind: "commit",
        ref: `${s.repo}/${s.sha}`,
        title: s.subject,
        snippet: s.body || s.subject,
        at: s.at,
        score: 0,
        phrase: false,
        meta: s.repo,
      });
  if (scope === "files")
    for (const f of [...getFiles()].sort((a, b) => b.mtime - a.mtime).slice(0, limit))
      out.push({
        kind: "file",
        ref: f.rel,
        title: f.name,
        snippet: f.rel,
        at: f.mtime,
        score: 0,
        phrase: false,
        path: f.rel,
        meta: f.ext ? "." + f.ext : "",
      });
  if (scope === "components")
    for (const c of COMPONENTS)
      out.push({
        kind: "component",
        ref: c.name,
        title: c.name,
        snippet: c.desc,
        at: REGISTRY_CREATED_AT,
        score: 0,
        phrase: false,
        path: c.file,
        meta: c.status,
      });
  if (scope === "projects")
    for (const p of getProjects())
      out.push({
        kind: "project",
        ref: p.name,
        title: p.name,
        snippet: `${p.sessions} session${p.sessions === 1 ? "" : "s"}`,
        at: p.lastActive,
        score: 0,
        phrase: false,
        meta: `${p.sessions}`,
      });
  if (scope === "skills")
    for (const k of getSkills())
      out.push({
        kind: "skill",
        ref: k.path,
        title: k.title,
        snippet: k.description || `/${k.name}`,
        at: k.mtime,
        score: 0,
        phrase: false,
        path: k.path,
        meta: `/${k.name}`,
      });
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
