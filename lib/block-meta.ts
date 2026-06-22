import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeFileAtomicSync } from "./atomic";

// HQ-native per-MESSAGE-BLOCK view state — favorite (a ★ cue on the block),
// hidden (CSS-hide it; the block is NEVER removed from the transcript), and a
// 👍/👎 reaction. Keyed by session id → block id (the source jsonl entry's uuid,
// falling back to its timestamp). A sidecar under ~/.claude/hq, exactly like
// sessions-meta — and like it, NEVER a write into Claude Code's transcript files.
// Blocks are to a transcript what sessions are to Recents.
const STORE_DIR = path.join(os.homedir(), ".claude", "hq");
const STORE = path.join(STORE_DIR, "block-meta.json");
const FEEDBACK = path.join(STORE_DIR, "feedback.jsonl");

export type Reaction = "up" | "down";
export type BlockMeta = {
  favorite?: boolean;
  hidden?: boolean;
  reaction?: Reaction;
};
// session id → (block id → meta)
export type BlocksMeta = Record<string, Record<string, BlockMeta>>;

type Store = { version: number; blocks: BlocksMeta };

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf8"));
    if (parsed && parsed.blocks && typeof parsed.blocks === "object")
      return { version: parsed.version ?? 1, blocks: parsed.blocks };
  } catch {
    /* missing or corrupt — empty (universal default, no setup) */
  }
  return { version: 1, blocks: {} };
}

function write(store: Store): void {
  writeFileAtomicSync(STORE, JSON.stringify(store, null, 2));
}

// All block meta for one session — the map the terminal hydrates on load.
export function getBlockMeta(sessionId: string): Record<string, BlockMeta> {
  return read().blocks[sessionId] ?? {};
}

// Merge a patch onto one block's meta. Falsey fields are pruned; an emptied block
// (and an emptied session) is dropped so the store only holds meaningful entries.
// `reaction: null` clears the reaction; omitting it leaves it unchanged.
export function setBlockMeta(
  sessionId: string,
  blockId: string,
  patch: { favorite?: boolean; hidden?: boolean; reaction?: Reaction | null }
): BlockMeta {
  const store = read();
  const forSession = store.blocks[sessionId] ?? {};
  const next: BlockMeta = { ...(forSession[blockId] ?? {}) };

  if (typeof patch.favorite === "boolean") {
    if (patch.favorite) next.favorite = true;
    else delete next.favorite;
  }
  if (typeof patch.hidden === "boolean") {
    if (patch.hidden) next.hidden = true;
    else delete next.hidden;
  }
  if (patch.reaction !== undefined) {
    if (patch.reaction === "up" || patch.reaction === "down") next.reaction = patch.reaction;
    else delete next.reaction;
  }

  if (Object.keys(next).length === 0) delete forSession[blockId];
  else forSession[blockId] = next;
  if (Object.keys(forSession).length === 0) delete store.blocks[sessionId];
  else store.blocks[sessionId] = forSession;
  write(store);
  return next;
}

// Append a 👍/👎 to a local feedback log — the durable, Claude-readable record of
// which replies to reinforce. The block-meta reaction above is the per-block
// toggle (so the cue persists); this is the running HISTORY a future session (or
// a memory-audit step) can read back to learn what worked. One JSON object per
// line. Best-effort — feedback logging never blocks the UI.
export function appendFeedback(entry: {
  reaction: Reaction;
  sessionId: string;
  blockId: string;
  text?: string; // a snippet of the reacted block, for context when read back
  project?: string;
}): void {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const line = JSON.stringify({ ...entry, loggedAt: new Date().toISOString() });
    fs.appendFileSync(FEEDBACK, line + "\n");
  } catch {
    /* swallow — a lost feedback line must never break the reaction */
  }
}
