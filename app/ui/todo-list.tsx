"use client";

import { useState } from "react";
import AccordionTodoItem from "@/app/ui/accordion-todo-item";
import SearchField from "@/app/ui/search-field";
import { CATEGORIES } from "@/app/ui/todo-categories";
import type { TodoItem } from "@/lib/todo";

// To Do over the HQ-native store (/api/todo). A to-do is a title + an optional
// markdown body (no sub-item records). This is the CONTAINER: it owns the list
// state + persistence (add / toggle / clear / reorder / expand / copy) and
// renders each row as a presentational <AccordionTodoItem/>, handing every
// interaction back through callbacks.
export default function TodoList({ initial }: { initial: TodoItem[] }) {
  const [items, setItems] = useState<TodoItem[]>(initial);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState(""); // search box over the list
  const [busy, setBusy] = useState(false);
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
  const list = needle
    ? byCat.filter(
        (t) =>
          t.text.toLowerCase().includes(needle) ||
          (t.body ?? "").toLowerCase().includes(needle)
      )
    : byCat;
  const doneCount = items.filter((t) => t.done).length;
  // Only show filter chips for categories that actually have items.
  const present = CATEGORIES.filter((c) =>
    all.some((t) => t.category === c.key)
  );

  async function add() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setDraft("");
    try {
      const res = await fetch("/api/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, addedBy: "you" }),
      });
      if (res.ok) {
        const { item } = await res.json();
        setItems((xs) => [item, ...xs]);
      }
    } finally {
      setBusy(false);
    }
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
      {/* Search header — faithfully ported from Components/Shipped (SearchField
          + a left-aligned caption). The caption doubles as the clear-completed
          link. The add-todo input below is left untouched (owned elsewhere). */}
      <div className="flex flex-col gap-1.5">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search to-dos…"
        />
        <p className="text-[11px] text-zinc-500">
          <button
            onClick={clearCompleted}
            className="transition-colors hover:text-zinc-300"
          >
            *Clear completed tasks ({doneCount})
          </button>
        </p>
      </div>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="Add todo, hit enter"
        className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
      />

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
              reorderEnabled={cat === null}
              dragSourceId={draggingId}
              dropEdge={dropTarget?.id === t.id ? dropTarget.pos : null}
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
