import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { writeFileAtomicSync } from "./atomic";

// HQ-native To Do store — the disk IS the database, same philosophy as the rest
// of HQ. Lives under ~/.claude (which exists for every Claude Code user), so To
// Do ships with ZERO dependency on a vault/Obsidian. A vault is now OPTIONAL: if
// you kept your roadmap in one, migrate the items in once; HQ never reads it
// again. New users get an empty store with no setup.
const STORE_DIR = path.join(os.homedir(), ".claude", "hq");
const STORE = path.join(STORE_DIR, "todo.json");

export type TodoItem = {
  id: string;
  text: string; // concise title (the collapsed row)
  done: boolean;
  createdAt: number;
  parentId?: string; // set → this is a sub-item of the parent todo
  claimedBy?: string; // session id of the terminal working it (two-agent coordination)
  body?: string; // rich description shown when the row is expanded (e.g. a /todo paste)
  addedBy?: string; // provenance: a session id (Claude via /todo) or "you" (added in HQ)
  fromSession?: string; // the session a "+ todo" was captured from (shown in the body)
  category?: string; // legacy single category (kept for the batch-optimizer)
  categories?: string[]; // user-set tags (multi); authoritative once defined, even if []
  pinned?: boolean; // starred → floats to the top of the list
  // ── Batch-optimizer graph (Stage-1 evaluator output; all optional) ──────────
  writes?: string[]; // files this todo is expected to modify
  reads?: string[]; // files it needs to read for context
  dependsOn?: string[]; // ids of todos that must complete first
  effort?: number; // estimated OUTPUT tokens to complete it
  evaluatedAt?: number; // when the evaluator last enriched this (freshness)
};

// Stage-1 evaluator output for one todo (the enrichment we persist back).
export type TodoGraph = {
  id: string;
  writes?: string[];
  reads?: string[];
  dependsOn?: string[];
  effort?: number;
  category?: string;
};

type Store = { version: number; items: TodoItem[] };

function read(): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf8"));
    if (parsed && Array.isArray(parsed.items)) {
      return { version: parsed.version ?? 1, items: parsed.items };
    }
  } catch {
    /* missing or corrupt — start empty (universal default, no vault) */
  }
  return { version: 1, items: [] };
}

function write(store: Store): void {
  // Atomic (temp→rename) so an interrupted write can never truncate the store
  // and wipe every to-do — see lib/atomic.ts (CODE-REVIEW BUG-1).
  writeFileAtomicSync(STORE, JSON.stringify(store, null, 2));
}

function newId(): string {
  return `t_${randomBytes(5).toString("hex")}`;
}

export function getTodos(): TodoItem[] {
  return read().items;
}

export function addTodo(
  text: string,
  extra?: {
    body?: string;
    addedBy?: string;
    parentId?: string;
    category?: string;
    fromSession?: string;
  }
): TodoItem {
  const store = read();
  let title = text.trim();
  let body = extra?.body?.trim();
  // A multi-line add (e.g. the "+ todo" chip): first line is the title, the rest
  // becomes the body — so a one-sentence description lands in the dropdown
  // instead of a giant truncated title.
  if (!body) {
    const nl = title.indexOf("\n");
    if (nl !== -1) {
      body = title.slice(nl + 1).trim();
      title = title.slice(0, nl).trim();
    }
  }
  const item: TodoItem = {
    id: newId(),
    text: title,
    done: false,
    createdAt: Date.now(),
  };
  if (body) item.body = body;
  if (extra?.addedBy) item.addedBy = extra.addedBy;
  if (extra?.parentId) item.parentId = extra.parentId;
  if (extra?.category) item.category = extra.category;
  if (extra?.fromSession) item.fromSession = extra.fromSession;
  store.items.unshift(item); // new to-dos go to the front of the list
  write(store);
  return item;
}

export function updateTodo(
  id: string,
  patch: Partial<
    Pick<
      TodoItem,
      "text" | "done" | "claimedBy" | "body" | "category" | "categories" | "pinned"
    >
  >
): TodoItem | null {
  const store = read();
  const item = store.items.find((i) => i.id === id);
  if (!item) return null;
  if (typeof patch.text === "string") item.text = patch.text.trim();
  if (typeof patch.done === "boolean") item.done = patch.done;
  if (typeof patch.body === "string") item.body = patch.body;
  if (typeof patch.category === "string") item.category = patch.category;
  if (Array.isArray(patch.categories)) item.categories = patch.categories;
  if (typeof patch.pinned === "boolean") item.pinned = patch.pinned;
  if ("claimedBy" in patch) {
    if (patch.claimedBy) item.claimedBy = patch.claimedBy;
    else delete item.claimedBy; // empty/null releases the claim
  }
  write(store);
  return item;
}

// Bulk-apply the Stage-1 evaluator's graph enrichment onto existing todos.
// Additive and isolated from updateTodo (the PATCH path the UI owns): only sets
// the graph fields provided, stamps evaluatedAt, never touches title/done/order.
export function enrichTodos(graphs: TodoGraph[]): TodoItem[] {
  const store = read();
  const byId = new Map(store.items.map((i) => [i.id, i]));
  const now = Date.now();
  for (const g of graphs) {
    const item = byId.get(g.id);
    if (!item) continue;
    if (Array.isArray(g.writes)) item.writes = g.writes;
    if (Array.isArray(g.reads)) item.reads = g.reads;
    if (Array.isArray(g.dependsOn)) item.dependsOn = g.dependsOn;
    if (typeof g.effort === "number") item.effort = g.effort;
    if (typeof g.category === "string") item.category = g.category;
    item.evaluatedAt = now;
  }
  write(store);
  return store.items;
}

export function removeTodo(id: string): boolean {
  const store = read();
  const before = store.items.length;
  store.items = store.items.filter((i) => i.id !== id);
  if (store.items.length === before) return false;
  write(store);
  return true;
}

// Reorder to the given id sequence (the draggable-cards feature). Ids absent
// from the store are ignored; items absent from `ids` keep their order at the
// end, so a partial list can't drop anything.
export function reorderTodos(ids: string[]): TodoItem[] {
  const store = read();
  const byId = new Map(store.items.map((i) => [i.id, i]));
  const ordered: TodoItem[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  }
  for (const item of store.items) if (byId.has(item.id)) ordered.push(item);
  store.items = ordered;
  write(store);
  return ordered;
}
