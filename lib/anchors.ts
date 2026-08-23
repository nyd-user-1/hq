import fs from "node:fs";
import path from "node:path";
import { claudeHome } from "./config";
import { writeFileAtomicSync } from "./atomic";

// ANCHORS — "anchored questions": the HQ-native record of every time the user
// selected a passage in the transcript, quoted it into the send box, and asked
// about it. One record per quote: WHERE it was (a text-quote selector — exact +
// a little prefix/suffix — that re-finds the passage across re-renders and across
// inline-element boundaries), WHAT was asked after it (the user's own words up to
// the next quote), and the full prompt as sent (to pair it with its answer turn
// at render time). A sidecar under ~/.claude/hq, like block-meta / sessions-meta —
// never a write into Claude Code's transcripts. The transcript already holds the
// quote + question (that's what was sent); this sidecar is what lets HQ render it
// as a navigable Q&A pair instead of a blockquote.
const STORE = path.join(claudeHome(), "hq", "anchors.json");

export type TextQuote = { exact: string; prefix: string; suffix: string };
export type Anchor = {
  id: string; // a_xxxxxxxx
  createdAt: string; // ISO — the send time
  quote: TextQuote; // where: re-findable text-quote selector over the transcript
  sourceTurn?: string; // uuid of the turn the selection started in (best effort)
  question: string; // the user's words that followed the quote (up to the next quote)
  sent: string; // the full prompt as sent — pairs this anchor with its user turn → answer turn
};

type Store = { version: number; sessions: Record<string, Anchor[]> };

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf8"));
    if (parsed && parsed.sessions && typeof parsed.sessions === "object")
      return { version: parsed.version ?? 1, sessions: parsed.sessions };
  } catch {
    /* missing or corrupt — empty (universal default, no setup) */
  }
  return { version: 1, sessions: {} };
}

export function getAnchors(sessionId: string): Anchor[] {
  return read().sessions[sessionId] ?? [];
}

// Append (idempotent on id) and return the session's full list.
export function addAnchors(sessionId: string, anchors: Anchor[]): Anchor[] {
  const store = read();
  const cur = store.sessions[sessionId] ?? [];
  const seen = new Set(cur.map((a) => a.id));
  for (const a of anchors) if (!seen.has(a.id)) cur.push(a);
  store.sessions[sessionId] = cur;
  writeFileAtomicSync(STORE, JSON.stringify(store, null, 2));
  return cur;
}

export function removeAnchor(sessionId: string, id: string): Anchor[] {
  const store = read();
  const next = (store.sessions[sessionId] ?? []).filter((a) => a.id !== id);
  if (next.length) store.sessions[sessionId] = next;
  else delete store.sessions[sessionId];
  writeFileAtomicSync(STORE, JSON.stringify(store, null, 2));
  return next;
}
