import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeFileAtomicSync } from "./atomic";

// HQ-native saved Fleet dashboard VIEWS — a board composition (metric ids) PLUS its
// grid arrangement (per-card x/y/w/h), so a card dragged to full-width is restored
// pixel-for-pixel. A sidecar under ~/.claude/hq (same home as todo.json /
// sessions-meta.json), so views survive a browser-storage wipe, a device restart,
// and a different browser — unlike the old localStorage-only store. NOT a write into
// Claude Code's transcripts (it's HQ view state, no such concept in CC's data).
const STORE_DIR = path.join(os.homedir(), ".claude", "hq");
const STORE = path.join(STORE_DIR, "fleet-views.json");

export type GridBox = { x: number; y: number; w: number; h: number };
export type SavedView = { name: string; ids: string[]; layout?: Record<string, GridBox> };

type Store = { version: number; views: SavedView[] };

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf8"));
    if (parsed && Array.isArray(parsed.views)) return { version: parsed.version ?? 1, views: parsed.views };
  } catch {
    /* missing or corrupt — empty (universal default, no setup) */
  }
  return { version: 1, views: [] };
}

export function getFleetViews(): SavedView[] {
  return read().views;
}

// Replace the whole list (the client owns ordering + dedupe). Sanitized to the known
// shape so a malformed PUT can't poison the store. Atomic write — see lib/atomic.
export function saveFleetViews(views: unknown): SavedView[] {
  const clean = Array.isArray(views) ? views.map(sanitize).filter((v): v is SavedView => !!v) : [];
  writeFileAtomicSync(STORE, JSON.stringify({ version: 1, views: clean }, null, 2));
  return clean;
}

function sanitize(v: unknown): SavedView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name.trim()) return null;
  const ids = Array.isArray(o.ids) ? o.ids.filter((x): x is string => typeof x === "string") : [];
  const out: SavedView = { name: o.name.trim(), ids };
  if (o.layout && typeof o.layout === "object") {
    const layout: Record<string, GridBox> = {};
    for (const [k, box] of Object.entries(o.layout as Record<string, unknown>)) {
      if (box && typeof box === "object") {
        const b = box as Record<string, unknown>;
        if (["x", "y", "w", "h"].every((p) => typeof b[p] === "number")) {
          layout[k] = { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number };
        }
      }
    }
    if (Object.keys(layout).length) out.layout = layout;
  }
  return out;
}
