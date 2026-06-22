import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { sessionMeta, cleanText, type RecentSession } from "./sessions";
import { scoreNorm, snippetAround, normalize } from "./text-search";
import { openSearchDb } from "./sqlite";

// Index format version — bump to force a clean full rebuild when the stored
// shape changes (incremental reuse keys on file mtime, not on extract logic,
// so a logic change like "stop lowercasing" must invalidate via version).
// MUST equal VERSION in scripts/build-search-index.mjs. v3 = the SQLite FTS5
// sink (was a JSON file through v2).
export const INDEX_VERSION = 3;

// The Session Archive: every Claude Code session ever (not the 7-day Recents
// window), browseable and full-text searchable. ~106 transcripts / ~2GB here.
//
// Browse = cached head-reads (incremental by mtime). Search would love ripgrep,
// but this machine has only slow BSD grep (22s) and an undocumented bundled
// ugrep — so instead we keep a persisted text index: the user+assistant text of
// each session (system-reminders stripped) lives in a SQLite FTS5 table
// (~/.claude/hq/search.db, built out-of-process in ~8s via node:sqlite, a Node
// BUILT-IN — zero npm deps). FTS5 gives prefix/type-ahead recall + bm25 ranking;
// the index is built incrementally (changed files only) and warmed in the
// background while you browse, so searches are then instant.

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

export type ArchiveSession = RecentSession & {
  sizeBytes: number;
  hits?: number; // match count when a search is active
};

// ---- Browse: metadata cache (head reads) -----------------------------------

const metaCache = new Map<
  string,
  { mtime: number; meta: RecentSession; size: number }
>();

function eachSessionFile(fn: (full: string, st: fs.Stats) => void): void {
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dp = path.join(PROJECTS_ROOT, dir.name);
    let names: string[];
    try {
      names = fs.readdirSync(dp);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dp, f);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size === 0) continue;
      fn(full, st);
    }
  }
}

export function getArchiveSessions(): ArchiveSession[] {
  const seen = new Set<string>();
  const out: ArchiveSession[] = [];
  eachSessionFile((full, st) => {
    seen.add(full);
    const c = metaCache.get(full);
    let meta: RecentSession;
    if (c && c.mtime === st.mtimeMs) meta = c.meta;
    else {
      meta = sessionMeta(full, st.mtimeMs);
      metaCache.set(full, { mtime: st.mtimeMs, meta, size: st.size });
    }
    out.push({ ...meta, sizeBytes: st.size });
  });
  for (const k of metaCache.keys()) if (!seen.has(k)) metaCache.delete(k);
  out.sort((a, b) => b.lastActive - a.lastActive);
  return out;
}

// ---- Search: persisted FTS5 index, built by a detached child ---------------

const BUILD_SCRIPT = path.join(process.cwd(), "scripts", "build-search-index.mjs");
let building = false;

// The stored format version of search.db (meta.version). Cached by db file mtime
// so a rebuild (atomic rename → new mtime) is re-read on the next query. Null
// when the db is missing, node:sqlite is unavailable, or the version != current.
type DbMeta = { builtMaxMtime: number };
function dbMeta(): DbMeta | null {
  const db = openSearchDb();
  if (!db) return null;
  try {
    const v = db.prepare("SELECT v FROM meta WHERE k = ?").get("version");
    if (!v || Number(v.v) !== INDEX_VERSION) return null; // stale shape → rebuild
    const b = db.prepare("SELECT v FROM meta WHERE k = ?").get("builtMaxMtime");
    return { builtMaxMtime: b ? Number(b.v) : 0 };
  } catch {
    return null; // mid-rename / corrupt — the next poll catches the new file
  }
}

// Build the FTS5 MATCH expression for AND-of-prefix recall: each query token
// becomes a `tok*` prefix term (type-ahead), double-quoted so punctuation/
// reserved chars can't inject FTS5 syntax. Tokens are already normalized to
// [a-z0-9] runs by queryTokens(), so this is belt-and-suspenders.
function ftsMatch(tokens: string[]): string {
  return tokens.map((t) => `"${t.replace(/"/g, "")}"*`).join(" ");
}

// Fallback reader for a transcript whose .jsonl has been swept off disk (Claude
// Code's `cleanupPeriodDays` cleanup, default 30 days). The builder retains such
// rows (retained=1), so their text outlives the file — turnsFor() can't read it,
// but the index still holds the cleaned user+assistant text. Returns null when
// the index has no record (never built / never indexed before the file aged out).
export function retainedTranscriptText(id: string): string | null {
  const db = openSearchDb();
  if (!db) return null;
  try {
    const row = db
      .prepare("SELECT body FROM transcripts WHERE id = ?")
      .get(id);
    const body = row && typeof row.body === "string" ? row.body : "";
    return body.trim() ? body : null;
  } catch {
    return null;
  }
}

// Spawn the out-of-process builder (deduped). Detached so the 2GB extract runs
// off the server's event loop; it writes the index atomically and exits.
function triggerBuild(): void {
  if (building) return;
  building = true;
  try {
    const child = spawn(process.execPath, [BUILD_SCRIPT], {
      detached: true,
      stdio: "ignore",
    });
    child.on("exit", () => {
      building = false;
    });
    child.on("error", () => {
      building = false;
    });
    child.unref();
  } catch {
    building = false;
  }
}

function newestSessionMtime(): number {
  let m = 0;
  eachSessionFile((_f, st) => {
    if (st.mtimeMs > m) m = st.mtimeMs;
  });
  return m;
}

// Called on browse: build if missing/stale, or refresh if a session is newer
// than the index (so new/updated sessions become searchable). Deduped + cheap.
export function warmIndex(): void {
  const meta = dbMeta();
  if (!meta) triggerBuild();
  else if (newestSessionMtime() > meta.builtMaxMtime + 1) triggerBuild();
}

export type TranscriptHit = { id: string; score: number; phrase: boolean; snippet: string };

// Live-scan extraction — the SAME cleaning as the index builder
// (scripts/build-search-index.mjs `extract`) so a freshly-read session matches
// identically. Cached by (file, mtime) and pre-normalized, so repeated searches
// of an unchanged active session never re-read or re-normalize.
const liveCache = new Map<string, { mtime: number; text: string; norm: string }>();
const LIVE_TAIL_BYTES = 4 * 1024 * 1024;
function liveEntry(file: string, mtime: number): { text: string; norm: string } {
  const c = liveCache.get(file);
  if (c && c.mtime === mtime) return c;
  let out = "";
  let raw = "";
  try {
    // Read only the last few MB, not the whole file. The active session can be
    // hundreds of MB; a full readFileSync per keystroke-search was a multi-second
    // event-loop block + a huge transient allocation (CODE-REVIEW PERF-3). The
    // tail holds the recent turns you're most likely searching mid-session; older
    // content is covered by the next FTS index build.
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - LIVE_TAIL_BYTES);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    raw = buf.toString("utf8");
    if (start > 0) {
      const nl = raw.indexOf("\n"); // drop the partial first line from the tail cut
      if (nl !== -1) raw = raw.slice(nl + 1);
    }
  } catch {
    // unreadable / vanished mid-read
  }
  for (const line of raw.split("\n")) {
    if (!line || line[0] !== "{") continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== "user" && e.type !== "assistant") continue;
    const content = e.message?.content;
    if (typeof content === "string") out += cleanText(content) + "\n";
    else if (Array.isArray(content))
      for (const b of content)
        if (b?.type === "text" && b.text) out += cleanText(b.text) + "\n";
  }
  const entry = { mtime, text: out, norm: normalize(out) };
  liveCache.set(file, entry);
  return entry;
}

// Full-text search over EVERY session's text. The 2GB archive comes from the
// prebuilt FTS5 index (prefix/type-ahead recall + bm25 candidate ranking);
// sessions NEWER than the index snapshot — the one you're typing in, mid-
// conversation — are LIVE-SCANNED fresh and merged ON TOP, so the active session
// is instantly searchable with no rebuild lag. Zero extra work when current.
// `building` true → no usable db yet (first run / version bump); the caller shows
// an "indexing" state.
//
// FTS5 supplies the candidate set + bm25 order, but the authoritative `phrase`
// (the hard narrowing TIER) and `score` come from scoreNorm() over each
// candidate's stored body — IDENTICAL semantics to the live-scan and to the
// pre-FTS5 JSON index, so the search layer's per-corpus phrase narrowing is
// unchanged. (FTS5's own phrase op is word-bounded + would diverge; we don't
// trust it for the tier.) bm25 maps to score only as a fallback for rare
// prefix-only hits where the literal token never appears verbatim.
export function searchTranscriptIndex(tokens: string[]): {
  hits: TranscriptHit[];
  building: boolean;
} {
  if (tokens.length === 0) return { hits: [], building: false };
  const meta = dbMeta();
  const db = meta ? openSearchDb() : null;
  if (!meta || !db) {
    triggerBuild();
    return { hits: [], building: true };
  }
  // Keyed by id so a live re-scan can override a stale index row.
  const byId = new Map<string, TranscriptHit>();
  try {
    // FTS5 prefix-AND candidates, bm25-ordered (lower=better, negative). We cap
    // generously — final order is recency-then-score in the search layer; this
    // just bounds the per-query scoreNorm pass over candidate bodies.
    const rows = db
      .prepare(
        "SELECT id, body, bm25(transcripts) AS rank FROM transcripts " +
          "WHERE transcripts MATCH ? ORDER BY rank LIMIT 500"
      )
      .all(ftsMatch(tokens));
    for (const r of rows) {
      const id = String(r.id);
      const body = typeof r.body === "string" ? r.body : "";
      const m = scoreNorm(normalize(body), tokens, { prefix: true });
      // score = the authoritative occurrence count; for a prefix-only hit (no
      // verbatim token) that's still ≥1 via prefixHits. Fall back to -bm25 so a
      // matched-but-uncounted row (defensive) still sorts sanely.
      const score = m.score > 0 ? m.score : -Number(r.rank ?? 0);
      byId.set(id, {
        id,
        score,
        phrase: m.phrase,
        snippet: snippetAround(body, tokens[0]),
      });
    }
  } catch {
    // db vanished/locked mid-query (a concurrent rebuild rename) — fall through
    // to the live-scan; warmIndex()/the next poll re-opens the fresh db.
    triggerBuild();
  }
  // Bridge the staleness window: any session modified since the index was built
  // (usually just the active one) is read fresh and merged. Only OVERRIDES on a
  // live hit — never deletes — so a slight extraction diff can't drop a valid
  // index hit (and transcripts are append-only, so that hit stays valid anyway).
  // Prefix-matched to stay consistent with the FTS5 index's recall.
  eachSessionFile((full, st) => {
    if (st.mtimeMs <= meta.builtMaxMtime + 1) return; // index already covers it
    const { text, norm } = liveEntry(full, st.mtimeMs);
    const m = scoreNorm(norm, tokens, { prefix: true });
    if (m.score === 0) return;
    const id = path.basename(full, ".jsonl");
    byId.set(id, { id, score: m.score, phrase: m.phrase, snippet: snippetAround(text, tokens[0]) });
  });
  return { hits: [...byId.values()], building };
}
