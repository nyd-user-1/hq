"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import TodoList from "@/app/ui/todo-list";
import { useTodoPanel } from "@/app/ui/todo-panel-state";

// Standalone To Do panel — the skills-panel push-in standard. The same TodoList
// the @panel/todo route renders, fed client-side from GET /api/todo. TodoList owns
// its own mutations (POST/PUT/DELETE /api/todo); the fetch nonce re-keys it so a
// reopen seeds from the latest store.
export default function TodoPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { open, setOpen } = useTodoPanel();
  const active = embedded || open;
  const [items, setItems] = useState<ComponentProps<typeof TodoList>["initial"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/todo", { cache: "no-store" }).then((res) => res.json());
      setItems(r?.items ?? []);
      setNonce((n) => n + 1);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const content = (
    <>
      {items ? (
        <div className="scrollbar-none -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <TodoList key={nonce} initial={items} />
        </div>
      ) : (
        <p className="font-mono text-[11px] text-zinc-600">{loading ? "loading…" : "no to-dos"}</p>
      )}
    </>
  );
  if (embedded) return content;
  return (
    <AppPanel rootId="todo-panel-root" open={open} onClose={() => setOpen(false)} widthClass="sm:w-[min(360px,40vw)]">
      <Boundary label="todo-panel.tsx">{content}</Boundary>
    </AppPanel>
  );
}
