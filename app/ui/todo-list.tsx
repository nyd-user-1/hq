"use client";

import { useState } from "react";
import Markdown from "@/app/ui/md";
import type { TodoItem } from "@/lib/todo";

// Drag marker — must match TODO_DND_TYPE in terminal.tsx.
const TODO_DND_TYPE = "application/x-hq-todo";
// Carries the item id during a row drag → dropping on another row reorders.
// (A drop on a terminal reads TODO_DND_TYPE/text and injects instead — the drop
// target decides; one drag serves both.)
const TODO_ID_TYPE = "application/x-hq-todo-id";

// lucide "copy" — hover-revealed copy affordance.
const CopyGlyph = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect width="13" height="13" x="9" y="9" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

// Categories for the filter + per-item tag. `key` is what's stored; label/chip
// are presentation. Add more here as new kinds of work surface.
const CATEGORIES = [
  { key: "efficiency", label: "Efficiency", chip: "bg-emerald-500/15 text-emerald-300" },
  { key: "ui", label: "UI/UX", chip: "bg-sky-500/15 text-sky-300" },
  { key: "functionality", label: "Functionality", chip: "bg-violet-500/15 text-violet-300" },
  { key: "data", label: "Data", chip: "bg-amber-500/15 text-amber-300" },
  { key: "docs", label: "Docs", chip: "bg-zinc-500/20 text-zinc-300" },
] as const;
const CAT_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// To Do over the HQ-native store (/api/todo). A to-do is a title + an optional
// markdown body (no sub-item records). Mirrors the terminal's message + tool-step
// language: a provenance header (● who · time · session) above a bordered card
// that expands to render its body as markdown. Per card: title = drag into a
// terminal, checkbox (right) = toggle, hover copy = copy, click row = expand.
export default function TodoList({ initial }: { initial: TodoItem[] }) {
  const [items, setItems] = useState<TodoItem[]>(initial);
  const [draft, setDraft] = useState("");
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
  const list = cat ? all.filter((t) => t.category === cat) : all;
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

  const provenance = (t: TodoItem) => {
    const isSession = !!t.addedBy && t.addedBy !== "you";
    const name = t.addedBy === "you" ? "you" : isSession ? "claude" : "added";
    const dot =
      t.addedBy === "you"
        ? "text-blue-500"
        : isSession
          ? "text-orange-500"
          : "text-zinc-600";
    return (
      <div className="flex items-center px-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        <span className={`mr-1.5 normal-case ${dot}`}>●</span>
        {name}
        <span className="ml-2 normal-case tracking-normal text-zinc-600">
          {new Date(t.createdAt).toLocaleTimeString()}
        </span>
        {t.category && CAT_BY_KEY[t.category] && (
          <span
            className={`ml-auto rounded px-1 normal-case tracking-normal ${CAT_BY_KEY[t.category].chip}`}
          >
            {CAT_BY_KEY[t.category].label}
          </span>
        )}
        {t.claimedBy && (
          <span
            title={`claimed by session ${t.claimedBy}`}
            className={`rounded bg-amber-500/15 px-1 normal-case tracking-normal text-amber-300/90 ${
              t.category ? "ml-2" : "ml-auto"
            }`}
          >
            {t.claimedBy.slice(0, 8)}
          </span>
        )}
      </div>
    );
  };

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
          {list.map((t, i) => {
            const sess =
              t.fromSession ||
              (t.addedBy && t.addedBy !== "you" ? t.addedBy : null);
            const expandable = !!t.body || !!sess;
            const open = expanded.has(t.id);
            return (
              <li
                key={t.id}
                className={`relative flex flex-col gap-1.5 transition-opacity ${
                  draggingId === t.id ? "opacity-40" : ""
                }`}
                onDragOver={(e) => {
                  if (cat !== null || !draggingId || draggingId === t.id) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const pos =
                    e.clientY < r.top + r.height / 2 ? "before" : "after";
                  setDropTarget((d) =>
                    d?.id === t.id && d.pos === pos ? d : { id: t.id, pos }
                  );
                }}
                onDrop={(e) => {
                  if (cat !== null || !draggingId) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  reorder(
                    t.id,
                    e.clientY < r.top + r.height / 2 ? "before" : "after"
                  );
                  setDropTarget(null);
                  setDraggingId(null);
                }}
              >
                {dropTarget?.id === t.id && dropTarget.pos === "before" && (
                  <span className="pointer-events-none absolute inset-x-0 -top-1.5 h-0.5 rounded bg-sky-500" />
                )}
                {provenance(t)}
                <div className="group/card rounded-md border border-zinc-800 bg-zinc-900/30">
                  <div
                    className={`flex items-center gap-2.5 px-3 py-1.5 ${
                      expandable ? "cursor-pointer" : ""
                    }`}
                    onClick={expandable ? () => toggleExpand(t.id) : undefined}
                  >
                    <span
                      className={`shrink-0 select-none text-[10px] text-zinc-100 transition-transform ${
                        open ? "rotate-90" : ""
                      } ${expandable ? "" : "invisible"}`}
                    >
                      ▶
                    </span>
                    <span className="shrink-0 font-mono text-xs text-zinc-600">
                      {i + 1}.
                    </span>
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(TODO_DND_TYPE, t.text);
                        e.dataTransfer.setData("text/plain", t.text);
                        e.dataTransfer.setData(TODO_ID_TYPE, t.id);
                        e.dataTransfer.effectAllowed = "copyMove";
                        setDraggingId(t.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropTarget(null);
                      }}
                      title={t.text}
                      className={`min-w-0 cursor-grab truncate text-xs active:cursor-grabbing ${
                        t.done ? "text-zinc-600 line-through" : "text-zinc-200"
                      }`}
                    >
                      {t.text}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copy(t);
                      }}
                      title="copy"
                      className="shrink-0 p-0 text-zinc-600 opacity-0 transition hover:text-zinc-200 focus:opacity-100 group-hover/card:opacity-100"
                    >
                      {copiedId === t.id ? (
                        <span className="text-green-400">✓</span>
                      ) : (
                        <CopyGlyph />
                      )}
                    </button>
                    {t.done ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(t.id);
                        }}
                        title="mark not done"
                        aria-label="Mark not done"
                        className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-green-600/70 bg-green-600/30 text-[10px] leading-none text-green-400 transition-colors hover:bg-green-600/40"
                      >
                        ✓
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(t.id);
                        }}
                        title="mark done"
                        aria-label="Mark done"
                        className="ml-auto size-4 shrink-0 rounded-[3px] border border-zinc-600 transition-colors hover:border-green-500 hover:bg-green-500/20"
                      />
                    )}
                  </div>
                  {open && (t.body || sess) && (
                    <div className="border-t border-zinc-800 px-3.5 py-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                      {t.body && <Markdown text={t.body} />}
                      {sess && (
                        <p className={`text-zinc-600 ${t.body ? "mt-2" : ""}`}>
                          from session {sess.slice(0, 8)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {dropTarget?.id === t.id && dropTarget.pos === "after" && (
                  <span className="pointer-events-none absolute inset-x-0 -bottom-1.5 h-0.5 rounded bg-sky-500" />
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
