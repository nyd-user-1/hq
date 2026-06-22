// Builds the Session Archive search index OUT OF PROCESS so the 2GB extract
// never blocks the dev server's event loop (the terminal polls every 1s).
// SINK: a SQLite FTS5 table at ~/.claude/hq/search.db (was a JSON file). FTS5
// gives prefix/type-ahead matching + bm25 ranking; node:sqlite is a BUILT-IN
// (zero npm deps) — experimental, so it prints an ExperimentalWarning to stderr
// (harmless; this script runs detached with stdio ignored anyway).
//
// Schema: transcripts(id, mtime, retained, body) as an FTS5 virtual table —
// `body` is the ORIGINAL-case cleaned conversation text (matching lowercases at
// search time) so result snippets read naturally; id/mtime/retained are
// UNINDEXED columns we just store + read back. A tiny meta(k,v) table holds the
// format VERSION and builtMaxMtime (the staleness bridge the reader uses to
// live-scan sessions newer than this build).
//
// Tokenizer is `unicode61 remove_diacritics 2` WITHOUT the porter stemmer: porter
// stems indexed terms ("deployment"→"deploy", "deploying"→"deploi"), which makes
// prefix queries miss unpredictably AND loosens exact-phrase matching — both
// break HQ's contract (predictable type-ahead prefix + a faithful contiguous-
// phrase TIER). Unstemmed unicode61 gives literal prefix recall that matches the
// reader's substring semantics.
//
// Incremental: reuses unchanged entries from the PREVIOUS search.db by mtime
// (re-extracting all ~2GB every build would be wasteful). Retention: entries
// whose .jsonl was swept off disk by Claude Code's 30-day cleanup are carried
// forward tagged retained=1 so their text outlives the file. Atomic via
// build-into-tmp + fs.renameSync.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { extractEntryText } from "./lib/extract-entry.mjs";

const ROOT = path.join(os.homedir(), ".claude", "projects");
const HQ_DIR = path.join(os.homedir(), ".claude", "hq");
const OUT = path.join(HQ_DIR, "search.db");
const TMP = OUT + ".tmp";
// Keep in sync with INDEX_VERSION in lib/archive.ts. Bumping it forces a full
// rebuild (prev rows are only reused when the prior db's version matches).
// v4: tool_use input paths/commands are now indexed too (see extract-entry.mjs).
const VERSION = 4;

async function extract(file) {
  let out = "";
  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(file),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line || line[0] !== "{") continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      out += extractEntryText(e); // shared with lib/archive.ts — must not drift
    }
  } catch {
    // unreadable
  }
  return out;
}

// Load the PREVIOUS search.db into a by-id map for incremental reuse + the
// retention sweep. Returns null on any failure (missing db / version mismatch /
// corrupt) → full rebuild.
function loadPrev() {
  if (!fs.existsSync(OUT)) return null;
  let db;
  try {
    db = new DatabaseSync(OUT, { readOnly: true });
  } catch {
    return null;
  }
  try {
    const v = db.prepare("SELECT v FROM meta WHERE k = ?").get("version");
    if (!v || Number(v.v) !== VERSION) {
      db.close();
      return null; // stale shape → full rebuild
    }
    const rows = db
      .prepare("SELECT id, mtime, retained, body FROM transcripts")
      .all();
    db.close();
    const byId = new Map();
    for (const r of rows)
      byId.set(String(r.id), {
        id: String(r.id),
        mtime: Number(r.mtime),
        retained: Number(r.retained) === 1,
        body: typeof r.body === "string" ? r.body : "",
      });
    return byId;
  } catch {
    try {
      db.close();
    } catch {
      // already closed
    }
    return null;
  }
}

const prev = loadPrev(); // Map<id, {id,mtime,retained,body}> | null

// Collect the rows to insert: reuse unchanged, extract changed/new.
const rows = []; // {id, mtime, retained, body}
const seenIds = new Set();
let builtMaxMtime = 0;

let dirs = [];
try {
  dirs = fs.readdirSync(ROOT, { withFileTypes: true });
} catch {
  dirs = [];
}
for (const d of dirs) {
  if (!d.isDirectory()) continue;
  const dp = path.join(ROOT, d.name);
  let names = [];
  try {
    names = fs.readdirSync(dp);
  } catch {
    continue;
  }
  for (const f of names) {
    if (!f.endsWith(".jsonl")) continue;
    const full = path.join(dp, f);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size === 0) continue;
    if (st.mtimeMs > builtMaxMtime) builtMaxMtime = st.mtimeMs;
    const id = path.basename(full, ".jsonl");
    seenIds.add(id);
    const p = prev && prev.get(id);
    if (p && p.mtime === st.mtimeMs && !p.retained) {
      // Unchanged + still on disk → reuse the stored body (no re-extract).
      rows.push({ id, mtime: st.mtimeMs, retained: 0, body: p.body });
      continue;
    }
    rows.push({
      id,
      mtime: st.mtimeMs,
      retained: 0,
      body: await extract(full),
    });
  }
}

// RETENTION: rows present in the old db but no longer produced by the disk walk
// (their .jsonl was swept by Claude Code's cleanupPeriodDays, default 30). Carry
// them forward with retained=1 so the cleaned text outlives the file — the
// history HQ exists to preserve. (Same semantics as the old JSON retention block.)
if (prev) {
  for (const [id, e] of prev) {
    if (seenIds.has(id)) continue; // freshly extracted or reused this pass
    rows.push({ id, mtime: e.mtime, retained: 1, body: e.body });
  }
}

// Build into a fresh tmp db, then atomically rename over search.db so the server
// never reads a half-built index.
try {
  fs.mkdirSync(HQ_DIR, { recursive: true });
} catch {
  // exists
}
for (const f of [TMP, TMP + "-journal", TMP + "-wal", TMP + "-shm"]) {
  try {
    fs.rmSync(f);
  } catch {
    // not present
  }
}

const db = new DatabaseSync(TMP);
db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
db.exec(
  `CREATE VIRTUAL TABLE transcripts USING fts5(id UNINDEXED, mtime UNINDEXED, retained UNINDEXED, body, tokenize='unicode61 remove_diacritics 2')`
);
db.exec("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)");

const ins = db.prepare(
  "INSERT INTO transcripts(id, mtime, retained, body) VALUES (?, ?, ?, ?)"
);
db.exec("BEGIN");
for (const r of rows) ins.run(r.id, r.mtime, r.retained, r.body);
db.exec("COMMIT");

const setMeta = db.prepare("INSERT INTO meta(k, v) VALUES (?, ?)");
setMeta.run("version", String(VERSION));
setMeta.run("builtMaxMtime", String(builtMaxMtime));
db.close();

fs.renameSync(TMP, OUT);
