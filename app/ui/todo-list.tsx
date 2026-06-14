"use client";

import { useState, type ReactNode } from "react";
import type { TodoItem } from "@/lib/todo";

// Drag marker — must match TODO_DND_TYPE in terminal.tsx. Dropping a card on a
// terminal pane fills that pane's message box with the to-do text.
const TODO_DND_TYPE = "application/x-hq-todo";

// lucide "copy" — the click-to-copy handle for sub-items (top-level rows use
// their number as the handle).
const CopyGlyph = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="inline-block align-[-1px]"
  >
    <rect width="13" height="13" x="9" y="9" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

// Interactive To Do over the HQ-native store (/api/todo). One level of
// sub-items: a parent renders as a collapsible group (done when all children
// are). Each row has three intentional targets: checkbox = toggle, leading
// handle (number / copy glyph) = click-to-copy, text = drag into a terminal.
export default function TodoList({ initial }: { initial: TodoItem[] }) {
  const [items, setItems] = useState<TodoItem[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const topLevel = items.filter((t) => !t.parentId);
  const kids = (id: string) => items.filter((t) => t.parentId === id);
  const doneCount = items.filter((t) => t.done).length;

  async function add() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setDraft("");
    try {
      const res = await fetch("/api/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const { item } = await res.json();
        setItems((xs) => [...xs, item]);
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

  function toggleCollapse(id: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // A parent copies itself + its sub-items as a block (paste a whole feature into
  // a terminal); a leaf or sub-item copies its own line.
  function copyText(t: TodoItem): string {
    const children = kids(t.id);
    return children.length
      ? [t.text, ...children.map((c) => `- ${c.text}`)].join("\n")
      : t.text;
  }
  function copy(t: TodoItem) {
    navigator.clipboard.writeText(copyText(t));
    setCopiedId(t.id);
    setTimeout(() => setCopiedId((c) => (c === t.id ? null : c)), 1200);
  }

  // Leading click-to-copy handle: a number for top-level rows, a copy glyph for
  // sub-items. Flashes a green check on copy.
  const copyHandle = (t: TodoItem, display: ReactNode, hasKids = false) => (
    <button
      onClick={() => copy(t)}
      title={hasKids ? "copy this item + its sub-items" : "copy this item"}
      className="mt-0.5 shrink-0 cursor-pointer p-0 font-mono text-zinc-600 transition-colors hover:text-zinc-200"
    >
      {copiedId === t.id ? <span className="text-green-400">✓</span> : display}
    </button>
  );

  // Draggable text (drag a to-do into a terminal as a prompt).
  const label = (t: TodoItem, extra = "") => (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TODO_DND_TYPE, t.text);
        e.dataTransfer.setData("text/plain", t.text);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title="drag into a terminal to use as a prompt"
      className={`min-w-0 flex-1 cursor-grab active:cursor-grabbing ${
        t.done ? "text-zinc-600 line-through" : "text-zinc-300"
      } ${extra}`}
    >
      {t.text}
    </span>
  );

  const checkbox = (t: TodoItem) =>
    t.done ? (
      <button
        onClick={() => toggle(t.id)}
        title="mark not done"
        aria-label="Mark not done"
        className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-green-600/70 bg-green-600/30 text-[9px] leading-none text-green-400 transition-colors hover:bg-green-600/40"
      >
        ✓
      </button>
    ) : (
      <button
        onClick={() => toggle(t.id)}
        title="mark done"
        aria-label="Mark done"
        className="mt-0.5 size-3.5 shrink-0 rounded-[3px] border border-zinc-600 transition-colors hover:border-green-500 hover:bg-green-500/20"
      />
    );

  // Which terminal claimed this item (two-agent coordination).
  const claimChip = (t: TodoItem) =>
    t.claimedBy ? (
      <span
        title={`claimed by session ${t.claimedBy}`}
        className="mt-0.5 shrink-0 rounded bg-amber-500/15 px-1 font-mono text-[10px] text-amber-300/90"
      >
        {t.claimedBy.slice(0, 8)}
      </span>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="add a to-do — ↵ to save"
        className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
      />

      {/* Clear-completed lives under the entry box and reserves its own line. */}
      <div className="flex min-h-[1.125rem] items-center">
        {doneCount > 0 && (
          <button
            onClick={clearCompleted}
            className="text-xs text-zinc-600 transition-colors hover:text-zinc-300"
          >
            Clear completed tasks ({doneCount})
          </button>
        )}
      </div>

      {topLevel.length > 0 ? (
        <ol className="scrollbar-none flex min-h-0 flex-1 list-none flex-col gap-1.5 overflow-y-auto text-sm">
          {topLevel.map((t, i) => {
            const children = kids(t.id);
            if (children.length === 0) {
              return (
                <li key={t.id} className="flex items-start gap-2">
                  {checkbox(t)}
                  {copyHandle(t, `${i + 1}.`)}
                  {label(t)}
                  {claimChip(t)}
                </li>
              );
            }
            const open = !collapsed.has(t.id);
            const allDone = children.every((c) => c.done);
            return (
              <li key={t.id}>
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => toggleCollapse(t.id)}
                    aria-label={open ? "Collapse" : "Expand"}
                    className="mt-0.5 w-3.5 shrink-0 text-zinc-500 transition-colors hover:text-zinc-200"
                  >
                    {open ? "▾" : "▸"}
                  </button>
                  {copyHandle(t, `${i + 1}.`, true)}
                  {label(t, allDone ? "line-through text-zinc-600" : "")}
                  {claimChip(t)}
                </div>
                {open && (
                  <ul className="ml-[1.4rem] mt-1.5 flex list-none flex-col gap-1.5 border-l border-zinc-800 pl-3">
                    {children.map((c) => (
                      <li key={c.id} className="flex items-start gap-2">
                        {checkbox(c)}
                        {copyHandle(c, <CopyGlyph />)}
                        {label(c)}
                        {claimChip(c)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-zinc-600">no to-do items yet</p>
      )}
    </div>
  );
}
