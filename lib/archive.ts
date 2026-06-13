import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { sessionMeta, type RecentSession } from "./sessions";

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
  entries: { id: string; text: string }[];
};
let loaded: Loaded | null = null;
let building = false;

// Read the persisted index (cached until the file's mtime changes).
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
    loaded = {
      fileMtime: st.mtimeMs,
      builtMaxMtime: j.builtMaxMtime ?? 0,
      entries: j.entries ?? [],
    };
    return loaded;
  } catch {
    return null; // mid-write / corrupt — the next poll will catch the rename
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

// Called on browse: build if missing, or refresh if a session is newer than the
// index (so new/updated sessions become searchable). Deduped + cheap.
export function warmIndex(): void {
  const idx = loadIndex();
  if (!idx) triggerBuild();
  else if (newestSessionMtime() > idx.builtMaxMtime + 1) triggerBuild();
}

// Synchronous: searches the loaded index. `building` true → no index yet (first
// run) or a refresh is in flight; the UI shows an "indexing" state and retries.
export function searchArchive(query: string): {
  hits: Map<string, number>;
  building: boolean;
} {
  const q = query.trim().toLowerCase();
  const hits = new Map<string, number>();
  if (!q) return { hits, building: false };

  const idx = loadIndex();
  if (!idx) {
    triggerBuild();
    return { hits, building: true };
  }
  for (const e of idx.entries) {
    let n = 0;
    let i = e.text.indexOf(q);
    while (i !== -1) {
      n++;
      i = e.text.indexOf(q, i + q.length);
    }
    if (n > 0) hits.set(e.id, n);
  }
  return { hits, building };
}
