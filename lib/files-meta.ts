import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeFileAtomicSync } from "./atomic";

// HQ-native per-FILE view metadata — favorite + custom title — keyed by a stable
// "kind:ref" id. The file-level twin of sessions-meta.ts (which does the same for
// sessions): a sidecar under ~/.claude/hq, NEVER a write into the source file, so
// it can't race a live writer and works for ANY cmdk item category (notes /
// memory / transcripts / todos / commits / docs / files). favorite/title are HQ
// *view* state — Claude Code has no such concept — so they belong here, not in
// its data files.
const STORE_DIR = path.join(os.homedir(), ".claude", "hq");
const STORE = path.join(STORE_DIR, "files-meta.json");

export type FileMeta = { favorite?: boolean; title?: string };
export type FilesMeta = Record<string, FileMeta>;
type Store = { version: number; files: FilesMeta };

// Stable key for an item across the app — same shape the cmdk viewer addresses by.
export function fileKey(kind: string, ref: string): string {
  return `${kind}:${ref}`;
}

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf8"));
    if (parsed && parsed.files && typeof parsed.files === "object") {
      return { version: parsed.version ?? 1, files: parsed.files };
    }
  } catch {
    /* missing or corrupt — empty (universal default, no setup) */
  }
  return { version: 1, files: {} };
}

function write(store: Store): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  writeFileAtomicSync(STORE, JSON.stringify(store, null, 2));
}

export function getFilesMeta(): FilesMeta {
  return read().files;
}

// Merge a patch onto one item's meta. Falsey/blank fields are pruned; an entry
// that becomes empty is removed entirely (reverts to plain defaults).
export function setFileMeta(key: string, patch: FileMeta): FileMeta {
  const store = read();
  const next: FileMeta = { ...(store.files[key] ?? {}) };

  if (typeof patch.favorite === "boolean") {
    if (patch.favorite) next.favorite = true;
    else delete next.favorite;
  }
  if (typeof patch.title === "string") {
    const t = patch.title.trim();
    if (t) next.title = t;
    else delete next.title;
  }

  if (Object.keys(next).length === 0) delete store.files[key];
  else store.files[key] = next;
  write(store);
  return next;
}
