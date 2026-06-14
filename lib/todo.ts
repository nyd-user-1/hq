import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";

// HQ-native To Do store — the disk IS the database, same philosophy as the rest
// of HQ. Lives under ~/.claude (which exists for every Claude Code user), so To
// Do ships with ZERO dependency on a vault/Obsidian. A vault is now OPTIONAL: if
// you kept your roadmap in one, migrate the items in once; HQ never reads it
// again. New users get an empty store with no setup.
const STORE_DIR = path.join(os.homedir(), ".claude", "hq");
const STORE = path.join(STORE_DIR, "todo.json");

export type TodoItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  parentId?: string; // set → this is a sub-item of the parent todo
  claimedBy?: string; // session id of the terminal working it (two-agent coordination)
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
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
}

function newId(): string {
  return `t_${randomBytes(5).toString("hex")}`;
}

export function getTodos(): TodoItem[] {
  return read().items;
}

export function addTodo(text: string): TodoItem {
  const store = read();
  const item: TodoItem = {
    id: newId(),
    text: text.trim(),
    done: false,
    createdAt: Date.now(),
  };
  store.items.push(item);
  write(store);
  return item;
}

export function updateTodo(
  id: string,
  patch: Partial<Pick<TodoItem, "text" | "done" | "claimedBy">>
): TodoItem | null {
  const store = read();
  const item = store.items.find((i) => i.id === id);
  if (!item) return null;
  if (typeof patch.text === "string") item.text = patch.text.trim();
  if (typeof patch.done === "boolean") item.done = patch.done;
  if ("claimedBy" in patch) {
    if (patch.claimedBy) item.claimedBy = patch.claimedBy;
    else delete item.claimedBy; // empty/null releases the claim
  }
  write(store);
  return item;
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
