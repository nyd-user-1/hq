import fs from "node:fs";
import path from "node:path";
import { metadataCorpus, memoryFilePath } from "./search";
import { getArchiveSessions } from "./archive";
import { NOTES_DIR } from "./notes";
import { sessionFilePath } from "./transcript";

// Finder-style listing of the FILE-BACKED items HQ tracks — notes, memory,
// skills, and EVERY transcript (all-time, not just recent) — with real fs.stat
// metadata (modified / created / size). The ALL view's data source. Non-file
// corpora (todos / commits / projects / components) live in their own scope
// chips: they have no file size/created. macOS-only columns (Date Added / Last
// Opened / Tags) are omitted — Spotlight/xattr metadata, not in fs.stat.
export type FileRow = {
  kind: string;
  ref: string;
  name: string; // human title (first line / session title)
  file: string; // the real on-disk filename, with extension
  modified: number; // ms
  created: number; // ms, -1 = unavailable
  size: number; // bytes, -1 = unavailable
  meta?: string;
};

// Small bounded corpora whose titles come from metadataCorpus; sessions are
// handled separately (all-time) so they're never capped to the recent set.
const FILE_KINDS = new Set(["note", "memory", "skill"]);

function resolvePath(kind: string, ref: string): string | null {
  if (kind === "note") return path.join(NOTES_DIR, ref);
  if (kind === "memory") return memoryFilePath(ref);
  if (kind === "skill") return ref; // metadataCorpus stores the absolute path as ref
  return null;
}

function statBits(p: string | null, fallbackModified: number) {
  let size = -1;
  let created = -1;
  let modified = fallbackModified;
  if (p) {
    try {
      const st = fs.statSync(p);
      size = st.size;
      created = st.birthtimeMs || -1;
      modified = st.mtimeMs;
    } catch {
      /* file gone — keep the fallback */
    }
  }
  return { size, created, modified };
}

// Memoize like the 5s corpus cache — the first open pays the enumerate+stat cost
// (~0.5s for hundreds of transcripts); repeats within the window are instant.
let cache: { at: number; rows: FileRow[] } | null = null;
const TTL_MS = 5000;

export function filesIndex(): FileRow[] {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows: FileRow[] = [];

  // notes / memory / skills
  for (const item of metadataCorpus()) {
    if (!FILE_KINDS.has(item.kind)) continue;
    const b = statBits(resolvePath(item.kind, item.ref), item.at);
    rows.push({
      kind: item.kind,
      ref: item.ref,
      name: item.title || item.ref,
      // note/memory refs ARE the filename; a skill ref is the absolute path.
      file: item.kind === "skill" ? path.basename(item.ref) : item.ref,
      modified: b.modified,
      created: b.created,
      size: b.size,
      meta: item.meta,
    });
  }

  // EVERY transcript — the whole point of "All". getArchiveSessions() is already
  // mtime-cached, and it carries sizeBytes; we stat once more only for birthtime
  // (created). Hundreds–thousands of statSync calls are sub-100ms.
  for (const s of getArchiveSessions()) {
    const kind = s.entrypoint === "sdk-cli" ? "sdk" : "session";
    let created = -1;
    try {
      created = fs.statSync(sessionFilePath(s.id)).birthtimeMs || -1;
    } catch {
      /* gone */
    }
    rows.push({
      kind,
      ref: s.id,
      name: s.customTitle || s.title || s.project || s.id,
      file: `${s.id}.jsonl`,
      modified: s.lastActive,
      created,
      size: s.sizeBytes ?? -1,
      meta: s.project,
    });
  }

  rows.sort((a, b) => b.modified - a.modified);
  cache = { at: Date.now(), rows };
  return rows;
}
