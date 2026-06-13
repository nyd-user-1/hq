"use client";

import { useState } from "react";
import type { TodoItem } from "@/lib/todo";

// Interactive To Do list over the HQ-native store (/api/todo). Add + check-off
// live, in HQ — no vault round-trip. Reorder/drag and the /todo skill build on
// the same API. SSR seeds `initial`; mutations are optimistic.
export default function TodoList({ initial }: { initial: TodoItem[] }) {
  const [items, setItems] = useState<TodoItem[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const active = items.filter((t) => !t.done);

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

  async function complete(id: string) {
    setItems((xs) => xs.map((t) => (t.id === id ? { ...t, done: true } : t)));
    await fetch("/api/todo", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, done: true }),
    }).catch(() => {});
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="add a to-do — ↵ to save"
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
        />
        <button
          onClick={add}
          disabled={!draft.trim() || busy}
          className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          add
        </button>
      </div>
      {active.length > 0 ? (
        <ol className="scrollbar-none flex min-h-0 flex-1 list-none flex-col gap-1.5 overflow-y-auto text-sm text-zinc-300">
          {active.map((t, i) => (
            <li key={t.id} className="flex items-start gap-2">
              <button
                onClick={() => complete(t.id)}
                title="mark done"
                aria-label="Mark done"
                className="mt-0.5 size-3.5 shrink-0 rounded-[3px] border border-zinc-600 transition-colors hover:border-green-500 hover:bg-green-500/20"
              />
              <span className="min-w-0 flex-1">
                <span className="mr-1.5 text-zinc-600">{i + 1}.</span>
                {t.text}
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
