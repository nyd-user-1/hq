"use client";

import { useState } from "react";
import type { TodoItem } from "@/lib/todo";

// Drag marker — must match TODO_DND_TYPE in terminal.tsx.
const TODO_DND_TYPE = "application/x-hq-todo";

// lucide "copy" — hover-revealed copy affordance (same idea as the terminal's
// message copy button).
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

// To Do over the HQ-native store (/api/todo). Each item mirrors the terminal's
// message + tool-step language: a provenance header (● who · time · session)
// above a bordered card; the card expands (like a tool step) to reveal a rich
// body and any sub-items. Per card: title = drag into a terminal, checkbox
// (right) = toggle, hover copy = copy the item (+ sub-items), click row = expand.
export default function TodoList({ initial }: { initial: TodoItem[] }) {
  const [items, setItems] = useState<TodoItem[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
        body: JSON.stringify({ text, addedBy: "you" }),
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

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function copyText(t: TodoItem): string {
    const children = kids(t.id);
    if (children.length)
      return [t.text, ...children.map((c) => `- ${c.text}`)].join("\n");
    return t.body ? `${t.text}\n\n${t.body}` : t.text;
  }
  function copy(t: TodoItem) {
    navigator.clipboard.writeText(copyText(t));
    setCopiedId(t.id);
    setTimeout(() => setCopiedId((c) => (c === t.id ? null : c)), 1200);
  }

  // ── shared pieces ──────────────────────────────────────────────────────────

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
          {isSession ? ` · ${t.addedBy!.slice(0, 8)}` : ""}
        </span>
        {t.claimedBy && (
          <span
            title={`claimed by session ${t.claimedBy}`}
            className="ml-auto rounded bg-amber-500/15 px-1 normal-case tracking-normal text-amber-300/90"
          >
            {t.claimedBy.slice(0, 8)}
          </span>
        )}
      </div>
    );
  };

  const dragTitle = (t: TodoItem, extra = "") => (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TODO_DND_TYPE, t.text);
        e.dataTransfer.setData("text/plain", t.text);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title="drag into a terminal to use as a prompt"
      className={`min-w-0 flex-1 cursor-grab leading-snug active:cursor-grabbing ${
        t.done ? "text-zinc-600 line-through" : "text-zinc-200"
      } ${extra}`}
    >
      {t.text}
    </span>
  );

  const hoverCopy = (t: TodoItem, group: string) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        copy(t);
      }}
      title="copy"
      className={`mt-px shrink-0 p-0 text-zinc-600 opacity-0 transition hover:text-zinc-200 ${group} focus:opacity-100`}
    >
      {copiedId === t.id ? (
        <span className="text-green-400">✓</span>
      ) : (
        <CopyGlyph />
      )}
    </button>
  );

  const checkbox = (t: TodoItem) =>
    t.done ? (
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggle(t.id);
        }}
        title="mark not done"
        aria-label="Mark not done"
        className="flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-green-600/70 bg-green-600/30 text-[10px] leading-none text-green-400 transition-colors hover:bg-green-600/40"
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
        className="size-4 shrink-0 rounded-[3px] border border-zinc-600 transition-colors hover:border-green-500 hover:bg-green-500/20"
      />
    );

  // ── rows ─────────────────────────────────────────────────────────────────

  function topRow(t: TodoItem, i: number) {
    const children = kids(t.id);
    const expandable = !!t.body || children.length > 0;
    const open = expanded.has(t.id);
    const allKidsDone = children.length > 0 && children.every((c) => c.done);
    return (
      <li key={t.id} className="flex flex-col gap-1.5">
        {provenance(t)}
        <div className="group/card rounded-md border border-zinc-800 bg-zinc-900/30">
          <div
            className={`flex items-start gap-3 px-3.5 py-3 ${
              expandable ? "cursor-pointer" : ""
            }`}
            onClick={expandable ? () => toggleExpand(t.id) : undefined}
          >
            <span
              className={`shrink-0 select-none font-mono text-zinc-600 transition-transform ${
                open ? "rotate-90" : ""
              } ${expandable ? "" : "invisible"}`}
            >
              ›
            </span>
            <span className="shrink-0 font-mono text-xs text-zinc-600">
              {i + 1}.
            </span>
            {dragTitle(t, allKidsDone ? "line-through !text-zinc-600" : "")}
            {hoverCopy(t, "group-hover/card:opacity-100")}
            {checkbox(t)}
          </div>
          {open && (
            <div className="border-t border-zinc-800 px-3.5 py-3">
              {t.body && (
                <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-400">
                  {t.body}
                </p>
              )}
              {children.length > 0 && (
                <ul
                  className={`flex flex-col gap-2.5 ${t.body ? "mt-3" : ""}`}
                >
                  {children.map((c) => subRow(c))}
                </ul>
              )}
            </div>
          )}
        </div>
      </li>
    );
  }

  function subRow(c: TodoItem) {
    return (
      <li
        key={c.id}
        className="group/sub flex items-start gap-3 border-l border-zinc-800 pl-3"
      >
        {dragTitle(c)}
        {hoverCopy(c, "group-hover/sub:opacity-100")}
        {checkbox(c)}
      </li>
    );
  }

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

      {topLevel.length > 0 ? (
        <ol className="scrollbar-none flex min-h-0 flex-1 list-none flex-col gap-3 overflow-y-auto pt-1 text-sm">
          {topLevel.map((t, i) => topRow(t, i))}
        </ol>
      ) : (
        <p className="text-sm text-zinc-600">no to-do items yet</p>
      )}
    </div>
  );
}
