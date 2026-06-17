"use client";

import { useRef, useState } from "react";
import AccordionTodoItem from "@/app/ui/accordion-todo-item";
import SearchField from "@/app/ui/search-field";
import SortIcon from "@/app/ui/sort-icon";
import { CATEGORIES } from "@/app/ui/todo-categories";
import type { TodoItem } from "@/lib/todo";

type SortMode = "manual" | "new" | "old";

// To Do over the HQ-native store (/api/todo). A to-do is a title + an optional
// markdown body (no sub-item records). This is the CONTAINER: it owns the list
// state + persistence (add / toggle / clear / reorder / expand / copy) and
// renders each row as a presentational <AccordionTodoItem/>, handing every
// interaction back through callbacks.
export default function TodoList({ initial }: { initial: TodoItem[] }) {
  const [items, setItems] = useState<TodoItem[]>(initial);
  const [draft, setDraft] = useState(""); // inline title editor for a "+"-added todo
  const [query, setQuery] = useState(""); // search box over the list
  const [sort, setSort] = useState<SortMode>("manual"); // manual = stored drag order
  const [editingId, setEditingId] = useState<string | null>(null);
  const editIdRef = useRef<string | null>(null); // mirrors editingId; guards Enter+blur double-fire
  const tmpRef = useRef(0); // counter for local temp ids (blank not yet persisted)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cat, setCat] = useState<string | null>(null); // active category filter
  const [draggingId, setDraggingId] = useState<string | null>(null); // row being reordered
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    pos: "before" | "after";
  } | null>(null);

  const all = items.filter((t) => !t.parentId);
  const byCat = cat ? all.filter((t) => t.category === cat) : all;
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? byCat.filter(
        (t) =>
          t.text.toLowerCase().includes(needle) ||
          (t.body ?? "").toLowerCase().includes(needle)
      )
    : byCat;
  // Sort is a view over the list: "manual" shows the stored drag order; a date
  // sort overrides it (and disables drag — see reorderEnabled below).
  const list =
    sort === "manual"
      ? filtered
      : [...filtered].sort((a, b) =>
          sort === "new" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt
        );
  const doneCount = items.filter((t) => t.done).length;
  // Only show filter chips for categories that actually have items.
  const present = CATEGORIES.filter((c) =>
    all.some((t) => t.category === c.key)
  );

  // "+" adds a blank row and opens it for inline rename. The blank lives only in
  // local state (a temp id) until you name it — so nothing hits disk if you bail,
  // and there are no orphan "New to-do" rows. Reset the view (manual sort, no
  // filter/search) so the new row sits at the top and stays visible while typing.
  function addBlank() {
    const id = `tmp_${tmpRef.current++}`;
    const item: TodoItem = {
      id,
      text: "",
      done: false,
      createdAt: Date.now(),
      addedBy: "you",
    };
    setItems((xs) => [item, ...xs]);
    setCat(null);
    setQuery("");
    setSort("manual");
    setDraft("");
    editIdRef.current = id;
    setEditingId(id);
  }

  // Close the inline title editor. Enter/blur → save; Escape or an empty title →
  // discard (the blank was never persisted, so this is purely local). On save we
  // POST and swap the temp row for the server's (real id, server createdAt).
  // editIdRef guards the Enter-then-blur double fire.
  function finishEdit(id: string, save: boolean) {
    if (editIdRef.current !== id) return;
    editIdRef.current = null;
    setEditingId(null);
    const text = draft.trim();
    setDraft("");
    if (!save || !text) {
      setItems((xs) => xs.filter((t) => t.id !== id)); // drop the uncommitted blank
      return;
    }
    setItems((xs) => xs.map((t) => (t.id === id ? { ...t, text } : t)));
    fetch("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, addedBy: "you" }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.item) {
          setItems((xs) => xs.map((t) => (t.id === id ? data.item : t)));
        }
      })
      .catch(() => {});
  }

  async function toggle(id: string) {
    const current = items.find((t) => t.id === id);
    if (!current) return;
    const next = !current.done;
    setItems((xs) => xs.map((t) => (t.id === id ? { ...t, done: next } : t)));
    await fetch("/api/todo", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, done: next }),
    }).catch(() => {});
  }

  async function clearCompleted() {
    const ids = items.filter((t) => t.done).map((t) => t.id);
    if (!ids.length) return;
    setItems((xs) => xs.filter((t) => !t.done));
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/todo?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        }).catch(() => {})
      )
    );
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function copy(t: TodoItem) {
    navigator.clipboard.writeText(t.body ? `${t.text}\n\n${t.body}` : t.text);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId((c) => (c === t.id ? null : c)), 1200);
  }

  // Move the dragged row before/after the target and persist the new order.
  function reorder(targetId: string, pos: "before" | "after") {
    if (!draggingId || draggingId === targetId) return;
    const order = items.map((i) => i.id).filter((id) => id !== draggingId);
    let at = order.indexOf(targetId);
    if (at < 0) return;
    if (pos === "after") at += 1;
    order.splice(at, 0, draggingId);
    const byId = new Map(items.map((i) => [i.id, i]));
    setItems(order.map((id) => byId.get(id)!));
    fetch("/api/todo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    }).catch(() => {});
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Search header — matches the Projects layout for design consistency:
          full-width SearchField, then a hint row with the clear-completed caption
          left and the sort + new buttons grouped right. */}
      <div className="flex flex-col gap-1.5">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search to-dos…"
        />
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-zinc-500">
            <button
              onClick={clearCompleted}
              className="transition-colors hover:text-zinc-300"
            >
              *Clear completed ({doneCount})
            </button>
          </p>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() =>
                setSort((s) =>
                  s === "manual" ? "new" : s === "new" ? "old" : "manual"
                )
              }
              title={
                sort === "manual"
                  ? "Manual order — drag to reorder. Click to sort newest first."
                  : sort === "new"
                    ? "Sorted newest first — click for oldest. Sorting overrides the manual drag order."
                    : "Sorted oldest first — click to return to manual drag order."
              }
              aria-label="Toggle sort order"
              aria-pressed={sort !== "manual"}
              className={`flex shrink-0 items-center rounded-md p-1.5 transition-colors ${
                sort === "manual"
                  ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  : "bg-zinc-800 text-zinc-100"
              }`}
            >
              <SortIcon dir={sort === "old" ? "old" : "new"} />
            </button>
            <button
              onClick={addBlank}
              title="New to-do"
              aria-label="New to-do"
              className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {present.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCat(null)}
            className={`rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors ${
              cat === null
                ? "bg-zinc-700 text-zinc-100"
                : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            All
          </button>
          {present.map((c) => (
            <button
              key={c.key}
              onClick={() => setCat((p) => (p === c.key ? null : c.key))}
              className={`rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors ${
                cat === c.key
                  ? c.chip
                  : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {list.length > 0 ? (
        <ol className="scrollbar-none flex min-h-0 flex-1 list-none flex-col gap-3 overflow-y-auto pt-1 text-sm">
          {list.map((t) => (
            <AccordionTodoItem
              key={t.id}
              item={t}
              open={expanded.has(t.id)}
              copied={copiedId === t.id}
              reorderEnabled={cat === null && sort === "manual"}
              dragSourceId={draggingId}
              dropEdge={dropTarget?.id === t.id ? dropTarget.pos : null}
              editing={editingId === t.id}
              editValue={draft}
              onEditChange={setDraft}
              onEditCommit={() => finishEdit(t.id, true)}
              onEditCancel={() => finishEdit(t.id, false)}
              onToggleExpand={() => toggleExpand(t.id)}
              onToggleDone={() => toggle(t.id)}
              onCopy={() => copy(t)}
              onDragStart={() => setDraggingId(t.id)}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTarget(null);
              }}
              onDragOverEdge={(pos) =>
                setDropTarget((d) =>
                  d?.id === t.id && d.pos === pos ? d : { id: t.id, pos }
                )
              }
              onDropEdge={(pos) => {
                reorder(t.id, pos);
                setDropTarget(null);
                setDraggingId(null);
              }}
            />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-zinc-600">
          {query ? `no to-dos matching “${query}”` : "no to-do items yet"}
        </p>
      )}
    </div>
  );
}
