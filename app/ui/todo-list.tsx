"use client";

import { useEffect, useRef, useState } from "react";
import AccordionTodoItem from "@/app/ui/accordion-todo-item";
import SearchField from "@/app/ui/search-field";
import { CATEGORIES, CAT_BY_KEY } from "@/app/ui/todo-categories";
import type { TodoItem } from "@/lib/todo";

// To Do over the HQ-native store (/api/todo). A to-do is a title + an optional
// markdown body (no sub-item records). This is the CONTAINER: it owns the list
// state + persistence (add / toggle / clear / reorder / expand / copy) and
// renders each row as a presentational <AccordionTodoItem/>, handing every
// interaction back through callbacks.
export default function TodoList({ initial }: { initial: TodoItem[] }) {
  const [items, setItems] = useState<TodoItem[]>(initial);
  const [draft, setDraft] = useState(""); // inline title editor for a "+"-added todo
  const [query, setQuery] = useState(""); // search box over the list
  const [editingId, setEditingId] = useState<string | null>(null);
  const editIdRef = useRef<string | null>(null); // mirrors editingId; guards Enter+blur double-fire
  const [bodyEditId, setBodyEditId] = useState<string | null>(null); // todo whose body is being edited in place
  const [bodyDraft, setBodyDraft] = useState("");
  const bodyEditIdRef = useRef<string | null>(null); // mirrors bodyEditId; guards esc-then-blur double-fire
  const tmpRef = useRef(0); // counter for local temp ids (blank not yet persisted)
  const [tagOpen, setTagOpen] = useState(false); // category-filter dropdown
  const tagRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cat, setCat] = useState<string | null>(null); // active category filter
  const [draggingId, setDraggingId] = useState<string | null>(null); // row being reordered
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    pos: "before" | "after";
  } | null>(null);

  // Close the category dropdown on an outside click or Escape.
  useEffect(() => {
    if (!tagOpen) return;
    const onDown = (e: MouseEvent) => {
      if (tagRef.current && !tagRef.current.contains(e.target as Node))
        setTagOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTagOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [tagOpen]);

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
  // No sort control here (it's "ironic" on a To Do list) — the list shows the
  // stored manual drag order; only category-filter + search narrow it.
  const list = filtered;
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
    setDraft("");
    editIdRef.current = id;
    setEditingId(id);
  }

  // Rename an existing todo: reuse the inline title editor (the kebab → Rename).
  function startRename(t: TodoItem) {
    setDraft(t.text);
    editIdRef.current = t.id;
    setEditingId(t.id);
  }

  // Delete a todo (kebab → Delete). Optimistic; the blank-id case is local-only.
  function deleteTodo(id: string) {
    setItems((xs) => xs.filter((t) => t.id !== id));
    if (id.startsWith("tmp_")) return;
    fetch(`/api/todo?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
      () => {}
    );
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
    const isNew = id.startsWith("tmp_");
    if (!save || !text) {
      if (isNew) setItems((xs) => xs.filter((t) => t.id !== id)); // drop the uncommitted blank
      return; // an existing todo: cancel leaves the title unchanged
    }
    setItems((xs) => xs.map((t) => (t.id === id ? { ...t, text } : t)));
    if (!isNew) {
      // Rename of an existing todo → PATCH the title, no view changes.
      fetch("/api/todo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, text }),
      }).catch(() => {});
      return;
    }
    // New blank → POST, swap the temp row for the server's (real id, createdAt).
    fetch("/api/todo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, addedBy: "you" }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.item) {
          setItems((xs) => xs.map((t) => (t.id === id ? data.item : t)));
          // Reveal the freshly-named todo's body so "add details…" is visible —
          // a user-created todo can grow a body just like a /todo or Claude one.
          setExpanded((s) => new Set(s).add(data.item.id));
        }
      })
      .catch(() => {});
  }

  // Edit-in-place for the markdown body (the "Edit state" roadmap, To Do first;
  // backend is updateTodo + PATCH /api/todo). Mirrors the title-rename pattern.
  function startBodyEdit(t: TodoItem) {
    setExpanded((s) => new Set(s).add(t.id)); // body must be visible to edit it
    setBodyDraft(t.body ?? "");
    bodyEditIdRef.current = t.id;
    setBodyEditId(t.id);
  }

  function cancelBodyEdit() {
    bodyEditIdRef.current = null;
    setBodyEditId(null);
    setBodyDraft("");
  }

  // Save on ⌘↵ or blur. editIdRef-style guard kills the esc-then-blur double fire.
  function commitBodyEdit(id: string) {
    if (bodyEditIdRef.current !== id) return;
    bodyEditIdRef.current = null;
    const body = bodyDraft.trim();
    setBodyEditId(null);
    setBodyDraft("");
    setItems((xs) =>
      xs.map((t) => (t.id === id ? { ...t, body: body || undefined } : t))
    );
    if (id.startsWith("tmp_")) return; // a not-yet-persisted blank — local only
    fetch("/api/todo", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, body }),
    }).catch(() => {});
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
          {/* + on the LEFT */}
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
          {/* Filter on the RIGHT — styled like the send box's model button; the
              category dropdown's trigger, opening bottom-right. Shows the active
              category (like the model button shows the model), else "Filter". */}
          <div ref={tagRef} className="relative ml-auto">
            <button
              onClick={() => setTagOpen((o) => !o)}
              title="filter by category"
              aria-label="Filter by category"
              aria-haspopup="menu"
              aria-expanded={tagOpen}
              className="flex max-w-full items-center rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <span className="truncate">
                {cat ? CAT_BY_KEY[cat].label : "Filter"}
              </span>
            </button>
            {tagOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 flex w-44 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setCat(null);
                    setTagOpen(false);
                  }}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
                >
                  <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                    All
                  </span>
                  {cat === null && (
                    <span className="ml-auto text-xs text-blue-400">✓</span>
                  )}
                </button>
                {present.map((c) => (
                  <button
                    key={c.key}
                    role="menuitem"
                    onClick={() => {
                      setCat((p) => (p === c.key ? null : c.key));
                      setTagOpen(false);
                    }}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
                  >
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${c.chip}`}
                    >
                      {c.label}
                    </span>
                    {cat === c.key && (
                      <span className="ml-auto text-xs text-blue-400">✓</span>
                    )}
                  </button>
                ))}
                {present.length === 0 && (
                  <p className="px-2 py-1.5 font-mono text-[10px] text-zinc-600">
                    no categories yet
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {list.length > 0 ? (
        <ol className="scrollbar-none flex min-h-0 flex-1 list-none flex-col gap-3 overflow-y-auto pt-1 text-sm">
          {list.map((t) => (
            <AccordionTodoItem
              key={t.id}
              item={t}
              open={expanded.has(t.id)}
              copied={copiedId === t.id}
              showTag={cat !== null}
              reorderEnabled={cat === null}
              dragSourceId={draggingId}
              dropEdge={dropTarget?.id === t.id ? dropTarget.pos : null}
              editing={editingId === t.id}
              editValue={draft}
              onEditChange={setDraft}
              onEditCommit={() => finishEdit(t.id, true)}
              onEditCancel={() => finishEdit(t.id, false)}
              bodyEditing={bodyEditId === t.id}
              bodyDraft={bodyDraft}
              onBodyEditStart={() => startBodyEdit(t)}
              onBodyChange={setBodyDraft}
              onBodyCommit={() => commitBodyEdit(t.id)}
              onBodyCancel={cancelBodyEdit}
              onRename={() => startRename(t)}
              onDelete={() => deleteTodo(t.id)}
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

      {/* Clear completed — relocated to the foot of the list (was the caption). */}
      <p className="text-xs text-zinc-600">
        <button
          onClick={clearCompleted}
          className="transition-colors hover:text-zinc-300"
        >
          *Clear completed ({doneCount})
        </button>
      </p>
    </div>
  );
}
