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
import { writeFileAtomicSync } from "./atomic";
import { COMPONENTS, REGISTRY_CREATED_AT } from "./components";
import { listDocs, docsText, DOCS_DIR } from "./docs";

// Universal search over everything HQ can see. Two flavors of corpus:
//  • CONTENT — full text of the thing (transcripts via the persisted index;
//    memory / notes / scripts read live; repo .md instruction files — CLAUDE.md,
//    AGENTS.md, README — read live too).
//  • METADATA — the thing's identity, not its body (sessions/sdk by title +
//    project + branch; files by path; components by name + desc; commits by
//    message; todos by text + body; projects by name; skills by name + desc).
// "transcripts" (conversation body) and "sessions" (session identity) are
// deliberately separate scopes — a different search, honestly labelled.
// Substring/token match with a context snippet, ranked newest-first.
//
// THE CONTRACT — surface everything Claude wrote to disk. If a file exists under
// ~/.claude/** or the repo, it is FINDABLE in "all" search. No corpus reader may
// silently drop a file BY TYPE (MEMORY.md, CLAUDE.md, the component registry, …
// were all exclusions we've removed). The only permitted limits are RECENCY caps
// (e.g. commits to the last 200/30d, sessions to 1000) — perf bounds on the
// *browse*, never a content filter on *search* — and each is commented as such.
// Adding a corpus = add it to SCOPES + the "all" fan-out, not gate it behind its
// own chip.

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

// ── Search-local read cache ────────────────────────────────────────────────
// The ⌘K palette hits these readers on EVERY keystroke, yet the underlying
// files (sessions, repo files, skills, memory/notes/scripts) don't change
// mid-search. Memoize each 5s — same as docsText/commits — so a typing burst
// does one read per corpus, not one-per-keystroke; this fixed read-cost was the
// bulk of the per-query floor (a zero-match query still paid it). Deliberately
// SEARCH-LOCAL (not pushed into the readers themselves): the rest of the app —
// the live Recents sidebar, the new-session UI — keeps reading fresh, so nothing
// else inherits a 5s lag.
const SEARCH_TTL = 5000;
const readCache = new Map<string, { at: number; val: unknown }>();
function memoRead<T>(key: string, fn: () => T): T {
  const hit = readCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < SEARCH_TTL) return hit.val as T;
  const val = fn();
  readCache.set(key, { at: now, val });
  return val;
}
const cachedFiles = () => memoRead("files", () => getFiles());
// Repo markdown bodies (CLAUDE.md, AGENTS.md, README, any *.md in the source
// roots) keyed by repo-rel path — the instruction/index files Claude writes to
// the repo, made FULL-TEXT searchable (not just findable by filename). Bounded to
// .md (a handful of files) and cached 5s like the other live reads, so scoreNorm
// runs over cached bytes. The deliberate exception to "files corpus = path only".
const repoMarkdown = () =>
  memoRead("repoMarkdown", () => {
    const out = new Map<string, string>();
    for (const f of cachedFiles()) {
      if (f.ext !== "md") continue;
      try {
        out.set(f.rel, fs.readFileSync(f.path, "utf8"));
      } catch {
        // vanished mid-scan
      }
    }
    return out;
  });
const cachedSkillsList = () => memoRead("skills", () => getSkills());
const cachedRecent = () => memoRead("recent1000", () => getRecentSessions(1000));
const cachedSdk = () => memoRead("sdk200", () => getSdkSessions(200));
const cachedProjectsList = () => memoRead("projects", () => getProjects());
const cachedArchiveSessions = () => memoRead("archiveSessions", () => getArchiveSessions());

// Cached file-content lists for the corpora read LIVE (memory/notes/scripts read
// every file's full text per query — the same trap docsText had). Same 5s memo,
// so scoreNorm runs over cached bytes instead of fresh reads.
type FileDoc = { name: string; content: string; mtime: number };
function readDir(dir: string, accept: (n: string) => boolean): FileDoc[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: FileDoc[] = [];
  for (const name of names) {
    if (!accept(name)) continue;
    try {
      const full = path.join(dir, name);
      out.push({ name, content: fs.readFileSync(full, "utf8"), mtime: fs.statSync(full).mtimeMs });
    } catch {
      // vanished mid-scan
    }
  }
  return out;
}
// Every per-project memory dir under ~/.claude/projects/*/memory. Claude writes
// memory under the slug of the CWD it was launched from, so a note can live under
// the home-dir slug OR a project-cwd slug (e.g. -Users-jane-Code-hq) —
// HQ used to read only the home-dir slug, so project memory (MEMORY.md, handoffs,
// hq-product-description.md…) was invisible to search. Scan them all.
function memoryDirs(): string[] {
  let slugs: string[];
  try {
    slugs = fs.readdirSync(PROJECTS_ROOT);
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const slug of slugs) {
    const dir = path.join(PROJECTS_ROOT, slug, "memory");
    try {
      if (fs.statSync(dir).isDirectory()) dirs.push(dir);
    } catch {
      // this project has no memory dir
    }
  }
  return dirs;
}
// Resolve a memory note's basename to its real path across all memory dirs (newest
// wins when the same name exists in two slugs — handoffs are written to both).
// Basename-only, joined to known dirs, so a crafted name can't walk out.
function findMemoryFile(name: string): string | null {
  const base = path.basename(name);
  if (!base.endsWith(".md")) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const dir of memoryDirs()) {
    try {
      const full = path.join(dir, base);
      const m = fs.statSync(full).mtimeMs;
      if (!best || m > best.mtime) best = { path: full, mtime: m };
    } catch {
      // not in this dir
    }
  }
  return best?.path ?? null;
}
const memoryDocs = () =>
  memoRead("memoryDocs", () => {
    const byName = new Map<string, FileDoc>();
    for (const dir of memoryDirs())
      // MEMORY.md (the index of all notes) is a real file Claude maintains on
      // disk, so it IS searchable — the surface-everything contract. It used to
      // be filtered out here as "not a note"; now a query for an index line finds
      // it like any other memory.
      for (const f of readDir(dir, (n) => n.endsWith(".md"))) {
        const prev = byName.get(f.name);
        if (!prev || f.mtime > prev.mtime) byName.set(f.name, f); // same note in two slugs → keep newest
      }
    return [...byName.values()];
  });
const noteDocs = () => memoRead("noteDocs", () => readDir(NOTES_DIR, (n) => n.endsWith(".md")));
const scriptDocs = () => memoRead("scriptDocs", () => readDir(SCRIPTS_DIR, isScript));

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
  | "skills"
  | "docs";

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
  | "skill"
  | "doc";

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
  { value: "docs", label: "Docs" },
];

// Result order. "rel" = most relevant first (score-ranked — the default for a
// query, so the FTS5/occurrence ranking actually surfaces); "new"/"old" =
// chronological (newest-first / oldest-first), the browse + "when did I first
// say X" modes.
export type SortDir = "new" | "old" | "rel";

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
  // A file chip's literal text is `path:line[:col]` (e.g. "components.ts:97") —
  // drop a trailing line/col suffix that follows a real extension so searching
  // the chip verbatim still matches the file. Without this the bare digits become
  // required tokens that no path contains, and the whole query returns nothing.
  // Anchored to a `.ext` so a genuine query like "port:8080" is left untouched.
  const q = query.replace(/(\.[a-z0-9]+):\d+(:\d+)?(?=\s|$)/gi, "$1");
  return normalize(q).split(" ").filter(Boolean);
}

// Transcripts: hits come from the all-time index (id + score + snippet); titles
// and timestamps come from the browse metadata. Naming mirrors the rest of the
// app — project name, falling back to the first prompt for home (~) sessions.
function searchTranscripts(toks: string[]): { hits: SearchHit[]; building: boolean } {
  const { hits: idxHits, building } = searchTranscriptIndex(toks);
  if (idxHits.length === 0) return { hits: [], building };

  const meta = new Map(cachedArchiveSessions().map((s) => [s.id, s]));
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
  const hits: SearchHit[] = [];
  for (const f of memoryDocs()) {
    const mt = scoreNorm(normalize(f.content), toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "memory",
      ref: f.name,
      title: f.name.slice(0, -3),
      snippet: snippetAround(f.content, toks[0]),
      at: f.mtime,
      score: mt.score,
      phrase: mt.phrase,
    });
  }
  return hits;
}

// Saved note blocks (~/.claude/hq/notes/*.md) — same substring/token read as
// memory. Title is the note's first body line (the filename is a timestamp).
function searchNotes(toks: string[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const f of noteDocs()) {
    const mt = scoreNorm(normalize(f.content), toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "note",
      ref: f.name,
      title: noteTitle(f.content),
      snippet: snippetAround(f.content, toks[0]),
      at: f.mtime,
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
  const hits: SearchHit[] = [];
  for (const f of scriptDocs()) {
    const mt = scoreNorm(normalize(f.content), toks);
    if (mt.score === 0) continue;
    hits.push({
      kind: "script",
      ref: f.name,
      title: f.name,
      snippet: snippetAround(f.content, toks[0]),
      at: f.mtime,
      score: mt.score,
      phrase: mt.phrase,
    });
  }
  return hits;
}

// Docs — the local Claude Code documentation mirror (~/.claude/hq/docs), HQ's
// offline best-practice corpus. Full-text like memory/notes (content is already
// MDX-stripped by the fetcher). Click opens the page in-panel. Reference
// material, so it rides "all" SEARCH but not the recency browse (like files/
// components) — surfaced there only when its own scope is picked.
function searchDocs(toks: string[]): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const d of docsText()) {
    const mt = scoreNorm(normalize(d.text), toks);
    if (mt.score === 0) continue;
    let at = 0;
    try {
      at = fs.statSync(path.join(DOCS_DIR, d.id)).mtimeMs;
    } catch {
      // page vanished mid-scan
    }
    hits.push({
      kind: "doc",
      ref: d.id,
      title: d.title,
      snippet: snippetAround(d.text, toks[0]),
      at,
      score: mt.score,
      phrase: mt.phrase,
      meta: d.id.includes("/") ? d.id.split("/")[0] : "docs",
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

// Files — match a file by its repo-relative PATH (name + dirs + ext). normalize()
// splits "planner-panel.tsx" → "planner panel tsx", so "planner", "tsx", or the
// phrase "planner panel" all hit. Repo .md instruction files (CLAUDE.md/AGENTS.md/
// README) ALSO match on CONTENT — searching "localhost trust boundary" surfaces
// AGENTS.md, not just its filename. Full content grep for source files is still
// the deferred v2; the .md exception keeps it cheap (a handful of files).
function searchFilesCorpus(toks: string[]): SearchHit[] {
  const md = repoMarkdown();
  const hits: SearchHit[] = [];
  for (const f of cachedFiles()) {
    const pathMt = sc(f.rel, toks);
    const body = md.get(f.rel);
    const bodyMt = body ? scoreNorm(normalize(body), toks) : { score: 0, phrase: false };
    // Best of path vs. content; a content hit yields a body snippet, a path hit
    // shows the path (so a filename match still reads as "where it lives").
    const contentWins = bodyMt.score > pathMt.score;
    const best = contentWins ? bodyMt : pathMt;
    if (best.score === 0) continue;
    hits.push({
      kind: "file",
      ref: f.rel,
      title: f.name,
      snippet: contentWins && body ? snippetAround(body, toks[0]) : f.rel,
      at: f.mtime,
      score: best.score,
      phrase: best.phrase,
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
// The 200-commit / 30-day window is a PERF bound on the git shell-out (the
// permitted kind of cap per the contract), not a content filter — raise it if
// "find that commit from two months ago" becomes a real gap.
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
  for (const p of cachedProjectsList()) {
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
  for (const k of cachedSkillsList()) {
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
      ? searchSessionRows(cachedRecent(), "session", toks)
      : [];
  const sdk =
    scope === "all" || scope === "sdk"
      ? searchSessionRows(cachedSdk(), "sdk", toks)
      : [];
  const fil = scope === "all" || scope === "files" ? searchFilesCorpus(toks) : [];
  const comp = scope === "all" || scope === "components" ? searchComponentsCorpus(toks) : [];
  const com = scope === "all" || scope === "commits" ? searchCommits(toks) : [];
  const td = scope === "all" || scope === "todos" ? searchTodos(toks) : [];
  const proj = scope === "all" || scope === "projects" ? searchProjects(toks) : [];
  const sk = scope === "all" || scope === "skills" ? searchSkills(toks) : [];
  const dc = scope === "all" || scope === "docs" ? searchDocs(toks) : [];

  // Phrase is a hard tier, but applied PER CORPUS — never globally. Searching a
  // full phrase IS a narrowing act, so within a corpus a contiguous-phrase hit
  // drops that corpus's scattered-term cards. But a verbatim match in ONE corpus
  // (say a transcript) must NOT blank a DIFFERENT corpus (say a doc page that has
  // every word but not the literal phrase) — that was the relevance trap, where
  // "understand the agentic loop" hid the agent-loop doc behind a chat transcript.
  // Narrow each corpus on its own, then merge.
  const corpora = [t.hits, m, n, s, sess, sdk, fil, comp, com, td, proj, sk, dc];
  const narrowed = corpora.flatMap((group) =>
    group.some((h) => h.phrase) ? group.filter((h) => h.phrase) : group
  );
  // "rel" ranks by score (occurrence count / FTS5 bm25 candidate order, with the
  // phrase tier already applied by the per-corpus narrowing above) — recency only
  // breaks ties. "new"/"old" rank chronologically with score as the tiebreak (so
  // the original/latest occurrence of a phrase rises). Since the /search page
  // queries each corpus on its own, "rel" effectively ranks WITHIN each corpus.
  const hits = narrowed
    .sort(
      sort === "rel"
        ? (a, b) => b.score - a.score || b.at - a.at
        : (a, b) => (sort === "old" ? 1 : -1) * (a.at - b.at) || b.score - a.score,
    )
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
      if (!name.endsWith(".md")) continue; // MEMORY.md included — it's a real file (surface-everything)
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
  if (scope === "docs")
    for (const d of listDocs())
      out.push({
        kind: "doc",
        ref: d.id,
        title: d.title,
        snippet: d.id,
        at: d.mtime,
        score: 0,
        phrase: false,
        meta: d.group || "docs",
      });
  const dir = sort === "old" ? 1 : -1;
  return out.sort((a, b) => dir * (a.at - b.at)).slice(0, limit);
}

// A compact "named thing" — the metadata corpora (sessions/components/todos/…),
// title only, no body. The ⌘K palette's fuzzy/typo pass scans these, so they're
// stripped to the fields it needs (and renders as a SearchHit).
export type CorpusItem = {
  kind: SearchKind;
  ref: string;
  title: string;
  at: number;
  meta?: string;
};

// The small metadata corpora as a flat, queryless snapshot — the input to the
// palette's typo-tolerance pass (lib/fuzzy). Several readers (sessions, projects,
// skills) aren't free, and this runs once per keystroke, so memoize it 5s like
// docsText/commits. Transcripts/docs/files are deliberately excluded — they're
// big (server full-text), and named-thing typos are where fuzzy actually helps.
let corpusCache: { at: number; items: CorpusItem[] } | null = null;
const CORPUS_TTL_MS = 5000;

export function metadataCorpus(): CorpusItem[] {
  if (corpusCache && Date.now() - corpusCache.at < CORPUS_TTL_MS) return corpusCache.items;
  const out: CorpusItem[] = [];
  for (const s of cachedRecent())
    out.push({ kind: "session", ref: s.id, title: s.customTitle || s.title || s.project, at: s.lastActive, meta: s.project });
  for (const s of cachedSdk())
    out.push({ kind: "sdk", ref: s.id, title: s.customTitle || s.title || s.project, at: s.lastActive, meta: s.project });
  for (const c of COMPONENTS)
    out.push({ kind: "component", ref: c.name, title: c.name, at: REGISTRY_CREATED_AT, meta: c.status });
  for (const t of getTodos()) {
    if (t.parentId) continue;
    out.push({ kind: "todo", ref: t.id, title: t.text, at: t.createdAt, meta: t.done ? "done" : t.category ?? "open" });
  }
  for (const p of cachedProjectsList())
    out.push({ kind: "project", ref: p.name, title: p.name, at: p.lastActive, meta: `${p.sessions}` });
  for (const k of cachedSkillsList())
    out.push({ kind: "skill", ref: k.path, title: k.title, at: k.mtime, meta: `/${k.name}` });
  for (const f of memoryDocs())
    out.push({ kind: "memory", ref: f.name, title: f.name.slice(0, -3), at: f.mtime });
  for (const f of noteDocs())
    out.push({ kind: "note", ref: f.name, title: noteTitle(f.content), at: f.mtime });
  corpusCache = { at: Date.now(), items: out };
  return out;
}

// Absolute path of a memory file — for the reader's click-to-copy path header.
// Resolved across all memory dirs (falls back to the home-slug dir if not found).
export function memoryFilePath(name: string): string {
  return findMemoryFile(name) ?? path.join(MEMORY_DIR, path.basename(name));
}

// Corpus scale, for the empty-state "N sessions · M memory notes" line.
export function corpusCounts(): { sessions: number; memory: number } {
  const memory = memoryDocs().length; // deduped across every project memory dir
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
  const full = findMemoryFile(name);
  if (!full) return null;
  try {
    return fs.readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

// Overwrite a memory note's full content (frontmatter included — the editor edits
// the raw file, so nothing is silently rewritten) in the dir it actually lives in.
// Edit-only: an unknown name returns false rather than creating a stray file.
// Atomic; resolved via findMemoryFile, so a crafted name can't escape the dirs.
export function writeMemoryFile(name: string, content: string): boolean {
  const full = findMemoryFile(name);
  if (!full) return false;
  try {
    writeFileAtomicSync(full, content);
    return true;
  } catch {
    return false;
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
