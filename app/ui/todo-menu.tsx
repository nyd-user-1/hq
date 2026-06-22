"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The send-box to-do button. A two-level drill-down borrowed from the solar
// projects' SolarPlusMenu: an initial menu (Add Todo / Get Todo), then a drawer
// with a search header + scrollable rows. "Add Todo" puts the current message on
// your HQ list (only shown when there's text to add); "Get Todo" drills into the
// open to-dos (search + auto-scroll) — pick one to drop its text into the box.
// Done/struck items are filtered out, so the list stays the live work only.

type Todo = { id: string; text: string; done: boolean; body?: string };
type Step = "menu" | "get";

export default function TodoMenu({
  draft,
  onAddDraft,
  onPick,
}: {
  draft: string;
  onAddDraft: () => void; // add the current message as a to-do
  onPick: (text: string) => void; // drop a to-do's text into the message box
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("menu");
  const [query, setQuery] = useState("");
  // null = not fetched yet; kept across closes so a reopen shows the last list
  // while it refetches in the background (no flash).
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setStep("menu");
    setQuery("");
  }, []);

  // Fetch the list each time it opens (cheap, keeps it fresh). setState lands
  // only in async callbacks, never synchronously in the effect body.
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/todo", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (live) setTodos(Array.isArray(d.items) ? d.items : []);
      })
      .catch(() => {
        if (live) setTodos([]);
      });
    return () => {
      live = false;
    };
  }, [open]);

  // Focus the search the moment the list drawer opens.
  useEffect(() => {
    if (open && step === "get") inputRef.current?.focus();
  }, [open, step]);

  // Outside-click + Escape close (Escape backs out of the drawer first).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (step === "get") {
        setStep("menu");
        setQuery("");
      } else close();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, step, close]);

  const q = query.trim().toLowerCase();
  // Open items only (drop the struck/completed), filtered by the search.
  const matches = (todos ?? [])
    .filter((t) => !t.done)
    .filter((t) => !q || `${t.text} ${t.body ?? ""}`.toLowerCase().includes(q));

  const canAdd = draft.trim().length > 0;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="To-dos"
        aria-expanded={open}
        title="your to-dos — add this message, or pull one into the box"
        className={`flex shrink-0 items-center rounded-md p-1.5 transition-colors ${
          open
            ? "bg-zinc-800 text-zinc-200"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        }`}
      >
        {/* lucide list-todo */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="5" width="6" height="6" rx="1" />
          <path d="m3 17 2 2 4-4" />
          <path d="M13 6h8" />
          <path d="M13 12h8" />
          <path d="M13 18h8" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 flex max-h-[340px] w-72 flex-col overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 shadow-xl">
          {/* ── INITIAL MENU — Add Todo / Get Todo ── */}
          {step === "menu" && (
            <div className="flex flex-col py-1">
              {canAdd && (
                <button
                  type="button"
                  onClick={() => {
                    onAddDraft();
                    close();
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-900"
                >
                  <span className="shrink-0 text-emerald-400">
                    {/* lucide plus */}
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-mono text-[11px] text-zinc-200">Add Todo</span>
                    <span className="truncate font-mono text-[10px] text-zinc-600">
                      this message → your to-do list
                    </span>
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setStep("get");
                  setQuery("");
                }}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-900 ${
                  canAdd ? "border-t border-zinc-800" : ""
                }`}
              >
                <span className="shrink-0 text-zinc-500">
                  {/* lucide list-todo */}
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="5" width="6" height="6" rx="1" />
                    <path d="m3 17 2 2 4-4" />
                    <path d="M13 6h8" />
                    <path d="M13 12h8" />
                    <path d="M13 18h8" />
                  </svg>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-mono text-[11px] text-zinc-200">Get Todo</span>
                  <span className="truncate font-mono text-[10px] text-zinc-600">
                    pull one into the message box
                  </span>
                </span>
                {/* lucide chevron-right */}
                <svg className="shrink-0 text-zinc-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          )}

          {/* ── GET DRAWER — back arrow + search + scrollable rows ── */}
          {step === "get" && (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-2.5 py-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep("menu");
                    setQuery("");
                  }}
                  aria-label="Back"
                  className="shrink-0 text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  {/* lucide arrow-left */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m12 19-7-7 7-7" />
                    <path d="M19 12H5" />
                  </svg>
                </button>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search to-dos…"
                  className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-300"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
                {todos === null ? (
                  <p className="px-2.5 py-3 font-mono text-[10px] text-zinc-600">loading…</p>
                ) : matches.length === 0 ? (
                  <p className="px-2.5 py-3 font-mono text-[10px] text-zinc-600">
                    {(todos ?? []).some((t) => !t.done) ? "no matches" : "no open to-dos"}
                  </p>
                ) : (
                  matches.map((t, i) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        onPick(t.text);
                        close();
                      }}
                      title="drop this to-do into the message box"
                      className={`flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-zinc-900 ${
                        i > 0 ? "border-t border-zinc-800/70" : ""
                      }`}
                    >
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-400/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[11px] text-zinc-200">
                          {t.text}
                        </span>
                        {t.body && (
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600">
                            {t.body}
                          </span>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
