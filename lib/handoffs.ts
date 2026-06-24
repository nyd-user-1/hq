import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeFileAtomicSync } from "./atomic";

// HQ↔terminal CONTROL-TRANSFER markers — the durable record of when HQ took the
// wheel of a session (first send → "to-hq") and handed it back to the TUI (a
// deliberate stop / Resume-in-terminal → "to-terminal"). A sidecar under
// ~/.claude/hq (same home as sessions-meta.json / todo.json), deliberately NOT a
// write into Claude Code's transcripts:
//   • a control-transfer is an HQ concept — Claude Code has none, so it doesn't
//     belong in its .jsonl.
//   • a sidecar can't race the live CLI that may be appending to the transcript.
// The turns route merges these into the timeline by `at` and the terminal renders
// them as dividers (cloned from the /clear command divider).
//
// NOTE: lib/vault.ts also exports a `latestHandoff` — that's an UNRELATED vault
// MEMO (a `kind: "handoff"` note), a different concept. This module is imported
// by file path, so there's no symbol clash, but keep them mentally distinct.
const STORE_DIR = path.join(os.homedir(), ".claude", "hq");
const STORE = path.join(STORE_DIR, "handoffs.json");

// "to-hq" = hq took the wheel of a session that wasn't a live terminal (a cold
// resume or a birth — continuity simply moves into hq). "fork-hq" = hq took the
// wheel of a session a Claude Code terminal was LIVE on, so this branches off it.
// "to-terminal" = the wheel went back to the TUI. The first two are the same
// "owner = hq" edge for idempotency (see recordHandoff).
export type HandoffDirection = "to-hq" | "fork-hq" | "to-terminal";

export type Handoff = {
  sessionId: string;
  direction: HandoffDirection;
  at: string; // ISO (new Date().toISOString()) — sorts/merges against TimelineItem.at
};

// The wheel owner an edge lands on — "to-hq"/"fork-hq" both mean hq has it.
const owner = (d: HandoffDirection): "hq" | "terminal" =>
  d === "to-terminal" ? "terminal" : "hq";

type Store = { version: number; entries: Handoff[] };

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf8"));
    if (parsed && Array.isArray(parsed.entries)) {
      return { version: parsed.version ?? 1, entries: parsed.entries };
    }
  } catch {
    /* missing or corrupt — empty (universal default, no setup) */
  }
  return { version: 1, entries: [] };
}

function write(store: Store): void {
  writeFileAtomicSync(STORE, JSON.stringify(store, null, 2)); // atomic — CODE-REVIEW BUG-1
}

// All markers for one session, oldest→newest (sorted by `at`).
export function handoffsFor(sessionId: string): Handoff[] {
  return read()
    .entries.filter((h) => h.sessionId === sessionId)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// The most recent marker for a session (or null) — used for the idempotency
// check below. (Named distinctly in intent from vault.ts:latestHandoff, which is
// an unrelated vault memo; no symbol clash since this module is imported by path.)
export function latestHandoff(sessionId: string): Handoff | null {
  const own = handoffsFor(sessionId);
  return own.length ? own[own.length - 1] : null;
}

// IDEMPOTENT record: a no-op if the session's latest direction already equals
// `direction`, so calling this on every send/stop only ever persists transition
// EDGES (on, off, on again all record; repeated sends do not — hence no dedup is
// needed at the call sites and there are ZERO new API routes). Skips `new:`
// placeholder ids (pre-birth), mirroring repl.ts:recordDriven, and caps the array
// to bound file growth.
export function recordHandoff(
  sessionId: string,
  direction: HandoffDirection,
): void {
  if (!sessionId || sessionId.startsWith("new:")) return;
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const store = read();
    const last = latestHandoff(sessionId);
    // Idempotent on the OWNER edge, not the exact direction: once hq has the wheel
    // ("fork-hq" on the forking send), the ordinary "to-hq" on every later send is a
    // no-op — so the fork divider isn't immediately followed by a plain one.
    if (last && owner(last.direction) === owner(direction)) return;
    store.entries = [
      ...store.entries,
      { sessionId, direction, at: new Date().toISOString() },
    ].slice(-2000); // bound growth (repl-sessions.json uses -300; markers are sparser)
    write(store);
  } catch {
    /* best-effort — a missing marker just loses a divider, never breaks a send */
  }
}
