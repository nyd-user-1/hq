import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// HQ-native per-session view metadata — favorite / hidden / custom title —
// keyed by session id. A sidecar under ~/.claude/hq (same home as todo.json),
// deliberately NOT a write into Claude Code's transcripts:
//   • favorite/hidden are HQ *view* state (how Recents sorts/filters) — Claude
//     Code has no such concept, so they don't belong in its data file.
//   • a sidecar can't race the live CLI that may be appending to the transcript.
// (Renaming could LATER also write a native custom_title into the transcript for
// cross-tool integration — a deliberate upgrade, tracked separately.)
const STORE_DIR = path.join(os.homedir(), ".claude", "hq");
const STORE = path.join(STORE_DIR, "sessions-meta.json");

export type SessionMeta = { favorite?: boolean; hidden?: boolean; title?: string };
export type SessionsMeta = Record<string, SessionMeta>;

type Store = { version: number; sessions: SessionsMeta };

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf8"));
    if (parsed && parsed.sessions && typeof parsed.sessions === "object") {
      return { version: parsed.version ?? 1, sessions: parsed.sessions };
    }
  } catch {
    /* missing or corrupt — empty (universal default, no setup) */
  }
  return { version: 1, sessions: {} };
}

function write(store: Store): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
}

export function getSessionsMeta(): SessionsMeta {
  return read().sessions;
}

// Merge a patch onto one session's meta. False/blank fields are pruned so the
// store only ever holds meaningful entries; an entry that becomes empty is
// removed entirely (a session reverts to plain defaults).
export function setSessionMeta(id: string, patch: SessionMeta): SessionMeta {
  const store = read();
  const next: SessionMeta = { ...(store.sessions[id] ?? {}) };

  if (typeof patch.favorite === "boolean") {
    if (patch.favorite) next.favorite = true;
    else delete next.favorite;
  }
  if (typeof patch.hidden === "boolean") {
    if (patch.hidden) next.hidden = true;
    else delete next.hidden;
  }
  if (typeof patch.title === "string") {
    const t = patch.title.trim();
    if (t) next.title = t;
    else delete next.title;
  }

  if (Object.keys(next).length === 0) delete store.sessions[id];
  else store.sessions[id] = next;
  write(store);
  return next;
}
