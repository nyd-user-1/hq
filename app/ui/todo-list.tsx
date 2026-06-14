"use client";

import { useState } from "react";
import { Inline } from "@/app/ui/md";
import type { TodoItem } from "@/lib/todo";

// Interactive To Do list over the HQ-native store (/api/todo). Add (↵) + toggle
// live, in HQ — no vault round-trip. Checking an item strikes it through IN
// PLACE (it doesn't move); "Clear completed tasks" (under the entry) deletes the
// checked ones. Item text renders as inline markdown (**bold**, ~~strike~~,
// ==highlight==, `code`, links). SSR seeds `initial`; mutations are optimistic.
export default function TodoList({ initial }: { initial: TodoItem[] }) {
  const [items, setItems] = useState<TodoItem[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

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

      {/* Clear-completed lives under the entry box and reserves its own line, so
          the list start doesn't jump when the button appears/disappears. */}
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

      {items.length > 0 ? (
        <ol className="scrollbar-none flex min-h-0 flex-1 list-none flex-col gap-1.5 overflow-y-auto text-sm">
          {items.map((t, i) => (
            <li key={t.id} className="flex items-start gap-2">
              {t.done ? (
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
              )}
              <span
                className={`min-w-0 flex-1 ${
                  t.done ? "text-zinc-600 line-through" : "text-zinc-300"
                }`}
              >
                <span className="mr-1.5 text-zinc-600">{i + 1}.</span>
                <Inline text={t.text} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-zinc-600">no to-do items yet</p>
      )}
    </div>
  );
}
