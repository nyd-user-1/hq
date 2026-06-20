// Tiny wrapper around Node's BUILT-IN `node:sqlite` (zero npm deps). HQ's only
// SQLite consumer is the transcript search index (the 2GB all-time archive,
// built out-of-process into ~/.claude/hq/search.db as an FTS5 table). Everything
// else stays a live node:fs read.
//
// `node:sqlite` is an EXPERIMENTAL Node API (stable enough here: v22.16.0 ships
// it with FTS5 compiled in). At runtime it only prints an ExperimentalWarning to
// stderr the first time it's required — harmless, and suppressed below so the dev
// server's logs stay clean. If the module is missing (older Node) or the db file
// hasn't been built yet, openSearchDb() returns null and every caller FALLS BACK
// (archive.ts live-scans, search degrades to "indexing"), so a consumer machine
// without the db still runs — it just has no prebuilt transcript index until the
// background build writes one.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

export const SEARCH_DB = path.join(os.homedir(), ".claude", "hq", "search.db");

// `node:sqlite` is an experimental built-in. Resolve it through require so a Node
// without it (or with the API behind a flag) degrades to null rather than a hard
// import crash. Cached at module load.
type DatabaseSyncCtor = new (
  filename: string,
  options?: { readOnly?: boolean }
) => SqliteDb;

export type SqliteDb = {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): unknown;
  };
  exec(sql: string): void;
  close(): void;
};

let ctor: DatabaseSyncCtor | null | undefined;
function sqliteCtor(): DatabaseSyncCtor | null {
  if (ctor !== undefined) return ctor;
  // Suppress the one-time ExperimentalWarning node:sqlite emits on first load.
  const orig = process.emitWarning;
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    const name =
      typeof warning === "object" && warning && "name" in warning
        ? (warning as { name?: string }).name
        : rest[0];
    const code =
      typeof rest[0] === "object" && rest[0] && "code" in rest[0]
        ? (rest[0] as { code?: string }).code
        : rest[1];
    if (name === "ExperimentalWarning" || code === "ExperimentalWarning") return;
    return (orig as (...a: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    const require = createRequire(import.meta.url);
    const mod = require("node:sqlite") as { DatabaseSync?: DatabaseSyncCtor };
    ctor = mod.DatabaseSync ?? null;
  } catch {
    ctor = null; // node:sqlite unavailable on this runtime
  } finally {
    process.emitWarning = orig;
  }
  return ctor;
}

// Module-level cache of the opened READ-ONLY db, invalidated when the file mtime
// changes (a fresh out-of-process build atomically renames a new search.db into
// place) — mirrors archive.ts's `loaded` mtime gate so a rebuild is picked up on
// the next query without a process restart.
let cached: { db: SqliteDb; mtime: number } | null = null;

export function openSearchDb(): SqliteDb | null {
  const C = sqliteCtor();
  if (!C) return null; // node:sqlite not available → caller falls back
  let st: fs.Stats;
  try {
    st = fs.statSync(SEARCH_DB);
  } catch {
    return null; // db not built yet → caller falls back / triggers a build
  }
  if (cached && cached.mtime === st.mtimeMs) return cached.db;
  // Stale handle (db was rebuilt) — close it before opening the new file.
  if (cached) {
    try {
      cached.db.close();
    } catch {
      // already gone
    }
    cached = null;
  }
  try {
    const db = new C(SEARCH_DB, { readOnly: true });
    cached = { db, mtime: st.mtimeMs };
    return db;
  } catch {
    return null; // mid-rename / corrupt — next query retries
  }
}

// Is node:sqlite usable on this runtime at all? (For callers that want to decide
// between "build the db" vs "stay JSON" without opening anything.)
export function sqliteAvailable(): boolean {
  return sqliteCtor() != null;
}
