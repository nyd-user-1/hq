import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { sessionMeta, cleanText, type RecentSession } from "./sessions";
import { scoreNorm, snippetAround, normalize } from "./text-search";

// Index format version — bump to force a clean full rebuild when the stored
// shape changes (incremental reuse keys on file mtime, not on extract logic,
// so a logic change like "stop lowercasing" must invalidate via version).
export const INDEX_VERSION = 2;

// The Session Archive: every Claude Code session ever (not the 7-day Recents
// window), browseable and full-text searchable. ~106 transcripts / ~2GB here.
//
// Browse = cached head-reads (incremental by mtime). Search would love ripgrep,
// but this machine has only slow BSD grep (22s) and an undocumented bundled
// ugrep — so instead we keep a tiny in-memory text index: the user+assistant
// text of each session (system-reminders stripped, lowercased) is only ~17MB
// total and extracts in ~8s. Built incrementally (changed files only) and warmed
// in the background while you browse, so searches are then instant.

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

// ---- Search: persisted text index, built by a detached child --------------

const INDEX_FILE = path.join(os.homedir(), ".claude", "hq-archive-index.json");
const BUILD_SCRIPT = path.join(process.cwd(), "scripts", "build-search-index.mjs");

type Loaded = {
  fileMtime: number;
  builtMaxMtime: number;
  // `text` is original-case (for readable snippets); `norm` is derived once at
  // load (lowercased, punctuation collapsed) so phrase matching never has to
  // normalize 16MB per search.
  entries: { id: string; text: string; norm: string }[];
};
let loaded: Loaded | null = null;
let building = false;

// Read the persisted index (cached until the file's mtime changes). A
// version mismatch is treated as "not built" → triggers a clean rebuild.
function loadIndex(): Loaded | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(INDEX_FILE);
  } catch {
    return null; // not built yet
  }
  if (loaded && loaded.fileMtime === st.mtimeMs) return loaded;
  try {
    const j = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
    if ((j.version ?? 1) !== INDEX_VERSION) return null; // stale shape → rebuild
    loaded = {
      fileMtime: st.mtimeMs,
      builtMaxMtime: j.builtMaxMtime ?? 0,
      entries: (j.entries ?? []).map(
        (e: { id: string; text: string }): Loaded["entries"][number] => ({
          id: e.id,
          text: e.text,
          norm: normalize(e.text),
        })
      ),
    };
    return loaded;
  } catch {
    return null; // mid-write / corrupt — the next poll will catch the rename
  }
}

// Fallback reader for a transcript whose .jsonl has been swept off disk (Claude
// Code's `cleanupPeriodDays` cleanup, default 30 days). The builder retains such
// entries, so their text outlives the file — turnsFor() can't read it, but the
// index still holds the cleaned user+assistant text. Returns null when the index
// has no record (never built / never indexed before the file aged out).
export function retainedTranscriptText(id: string): string | null {
  const idx = loadIndex();
  if (!idx) return null;
  const e = idx.entries.find((x) => x.id === id);
  return e && e.text.trim() ? e.text : null;
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

// Called on browse: build if missing, or refresh if a session is newer than the
// index (so new/updated sessions become searchable). Deduped + cheap.
export function warmIndex(): void {
  const idx = loadIndex();
  if (!idx) triggerBuild();
  else if (newestSessionMtime() > idx.builtMaxMtime + 1) triggerBuild();
}

export type TranscriptHit = { id: string; score: number; phrase: boolean; snippet: string };

// Live-scan extraction — the SAME cleaning as the index builder
// (scripts/build-search-index.mjs `extract`) so a freshly-read session matches
// identically. Cached by (file, mtime) and pre-normalized, so repeated searches
// of an unchanged active session never re-read or re-normalize.
const liveCache = new Map<string, { mtime: number; text: string; norm: string }>();
function liveEntry(file: string, mtime: number): { text: string; norm: string } {
  const c = liveCache.get(file);
  if (c && c.mtime === mtime) return c;
  let out = "";
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
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

// Synchronous full-text search over EVERY session's text. The 2GB archive comes
// from the prebuilt index; sessions NEWER than the index snapshot — the one you're
// typing in, mid-conversation — are LIVE-SCANNED fresh and merged ON TOP, so the
// active session is instantly searchable with no rebuild lag (the same read-per-
// query idea notes/memory use). Zero extra work when the index is current.
// `building` true → no index yet (first run); the caller shows an "indexing" state.
export function searchTranscriptIndex(tokens: string[]): {
  hits: TranscriptHit[];
  building: boolean;
} {
  if (tokens.length === 0) return { hits: [], building: false };
  const idx = loadIndex();
  if (!idx) {
    triggerBuild();
    return { hits: [], building: true };
  }
  // Keyed by id so a live re-scan can override a stale index entry.
  const byId = new Map<string, TranscriptHit>();
  for (const e of idx.entries) {
    const m = scoreNorm(e.norm, tokens);
    if (m.score === 0) continue;
    byId.set(e.id, {
      id: e.id,
      score: m.score,
      phrase: m.phrase,
      snippet: snippetAround(e.text, tokens[0]),
    });
  }
  // Bridge the staleness window: any session modified since the index was built
  // (usually just the active one) is read fresh and merged. Only OVERRIDES on a
  // live hit — never deletes — so a slight extraction diff can't drop a valid
  // index hit (and transcripts are append-only, so that hit stays valid anyway).
  eachSessionFile((full, st) => {
    if (st.mtimeMs <= idx.builtMaxMtime + 1) return; // index already covers it
    const { text, norm } = liveEntry(full, st.mtimeMs);
    const m = scoreNorm(norm, tokens);
    if (m.score === 0) return;
    const id = path.basename(full, ".jsonl");
    byId.set(id, { id, score: m.score, phrase: m.phrase, snippet: snippetAround(text, tokens[0]) });
  });
  return { hits: [...byId.values()], building };
}
