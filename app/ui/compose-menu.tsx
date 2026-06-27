"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The send-box "+" menu — one button, three things you can add to the message:
//   Attach   → a screenshot (the old paperclip; a direct action)
//   Todo  ▸  → Add this message as a to-do, or pull an open to-do into the box
//   Command ▸→ search every slash command/skill, drop one into the box as "/name "
//
// Replaces the separate attach + to-do buttons. Picking a command STAGES it (the
// composer colors a leading "/cmd" like the terminal) — it never auto-runs; you
// hit ↵. Same dropdown mechanics as the old TodoMenu (outside-click + Escape that
// backs out one level at a time).

type Todo = { id: string; text: string; done: boolean; body?: string };
type Cmd = { name: string; description: string; sourceLabel: string };
type Step = "root" | "todo" | "todo-get" | "command";

export default function ComposeMenu({
  draft,
  onAttach,
  onAddDraft,
  onPick,
  onPickCommand,
}: {
  draft: string;
  onAttach: () => void; // open the file picker (attach a screenshot)
  onAddDraft: () => void; // add the current message as a to-do
  onPick: (text: string) => void; // drop a to-do's text into the box
  onPickCommand: (text: string) => void; // drop "/name " into the box
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("root");
  const [query, setQuery] = useState("");
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [cmds, setCmds] = useState<Cmd[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setStep("root");
    setQuery("");
  }, []);

  // Lazy-load each list when its drawer first opens (kept across closes so a
  // reopen shows the last list while it refetches — no flash).
  useEffect(() => {
    if (step !== "todo-get") return;
    let live = true;
    fetch("/api/todo", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && setTodos(Array.isArray(d.items) ? d.items : []))
      .catch(() => live && setTodos([]));
    return () => {
      live = false;
    };
  }, [step]);

  useEffect(() => {
    if (step !== "command") return;
    let live = true;
    // Everything you can type with "/": the command library (built-in + yours +
    // plugin + MCP) AND skills (where /handoff, /note, … live). Merged + deduped.
    Promise.all([
      fetch("/api/commands", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      fetch("/api/skills", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    ]).then(([c, s]) => {
      if (!live) return;
      const rows: Cmd[] = [
        ...((c.commands ?? []) as Cmd[]),
        ...((s.skills ?? []) as Cmd[]),
      ].map((x) => ({ name: x.name, description: x.description ?? "", sourceLabel: x.sourceLabel ?? "" }));
      const seen = new Set<string>();
      const deduped = rows
        .filter((x) => (seen.has(x.name) ? false : (seen.add(x.name), true)))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCmds(deduped);
    });
    return () => {
      live = false;
    };
  }, [step]);

  // Focus the search the moment a drawer with one opens.
  useEffect(() => {
    if (open && (step === "todo-get" || step === "command")) inputRef.current?.focus();
  }, [open, step]);

  // Outside-click + Escape (Escape backs out one level at a time).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (step === "todo-get") setStep("todo");
      else if (step === "todo" || step === "command") setStep("root");
      else close();
      setQuery("");
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, step, close]);

  const q = query.trim().toLowerCase();
  const todoMatches = (todos ?? [])
    .filter((t) => !t.done)
    .filter((t) => !q || `${t.text} ${t.body ?? ""}`.toLowerCase().includes(q));
  const cmdMatches = (cmds ?? []).filter(
    (c) => !q || `${c.name} ${c.description} ${c.sourceLabel}`.toLowerCase().includes(q),
  );
  const canAdd = draft.trim().length > 0;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Add to message"
        aria-expanded={open}
        title="add to the message — attach, a to-do, or a command"
        className={`flex shrink-0 items-center rounded-md p-1.5 transition-colors ${
          open ? "bg-zinc-800 text-zinc-200" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        }`}
      >
        {/* lucide plus */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 flex max-h-[360px] w-72 flex-col overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 shadow-xl">
          {/* ── ROOT — Attach · Todo ▸ · Command ▸ ── */}
          {step === "root" && (
            <div className="flex flex-col py-1">
              <Row
                icon={<PlusIcon />}
                tint="text-emerald-400"
                title="Attach"
                sub="a screenshot → the message"
                onClick={() => {
                  onAttach();
                  close();
                }}
              />
              <Row
                icon={<TodoIcon />}
                tint="text-amber-400"
                title="Todo"
                sub="add this message, or pull one in"
                chevron
                divider
                onClick={() => setStep("todo")}
              />
              <Row
                icon={<CommandIcon />}
                tint="text-violet-300"
                title="Command"
                sub="drop a slash command into the box"
                chevron
                divider
                onClick={() => setStep("command")}
              />
            </div>
          )}

          {/* ── TODO sub-menu — Add Todo / Get Todo ▸ ── */}
          {step === "todo" && (
            <div className="flex flex-col py-1">
              <DrawerHeader onBack={() => setStep("root")} label="To-dos" />
              {canAdd && (
                <Row
                  icon={<PlusIcon />}
                  tint="text-emerald-400"
                  title="Add Todo"
                  sub="this message → your to-do list"
                  onClick={() => {
                    onAddDraft();
                    close();
                  }}
                />
              )}
              <Row
                icon={<TodoIcon />}
                tint="text-zinc-500"
                title="Get Todo"
                sub="pull one into the message box"
                chevron
                divider={canAdd}
                onClick={() => {
                  setStep("todo-get");
                  setQuery("");
                }}
              />
            </div>
          )}

          {/* ── TODO list ── */}
          {step === "todo-get" && (
            <>
              <SearchHeader
                inputRef={inputRef}
                value={query}
                onChange={setQuery}
                onBack={() => {
                  setStep("todo");
                  setQuery("");
                }}
                placeholder="Search to-dos…"
              />
              <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
                {todos === null ? (
                  <Empty>loading…</Empty>
                ) : todoMatches.length === 0 ? (
                  <Empty>{(todos ?? []).some((t) => !t.done) ? "no matches" : "no open to-dos"}</Empty>
                ) : (
                  todoMatches.map((t, i) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        onPick(t.text);
                        close();
                      }}
                      title="drop this to-do into the message box"
                      className={`flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-zinc-900 ${i > 0 ? "border-t border-zinc-800/70" : ""}`}
                    >
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-400/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[11px] text-zinc-200">{t.text}</span>
                        {t.body && <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600">{t.body}</span>}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {/* ── COMMAND list ── */}
          {step === "command" && (
            <>
              <SearchHeader
                inputRef={inputRef}
                value={query}
                onChange={setQuery}
                onBack={() => {
                  setStep("root");
                  setQuery("");
                }}
                placeholder={cmds ? `Search ${cmds.length} commands…` : "Search commands…"}
              />
              <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
                {cmds === null ? (
                  <Empty>loading…</Empty>
                ) : cmdMatches.length === 0 ? (
                  <Empty>no commands match</Empty>
                ) : (
                  cmdMatches.slice(0, 100).map((c, i) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => {
                        onPickCommand(`/${c.name} `);
                        close();
                      }}
                      title={`drop /${c.name} into the message box`}
                      className={`flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-zinc-900 ${i > 0 ? "border-t border-zinc-800/70" : ""}`}
                    >
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-violet-400/70" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="truncate font-mono text-[11px] text-violet-200">/{c.name}</span>
                          {c.sourceLabel && <span className="shrink-0 font-mono text-[9px] text-zinc-600">{c.sourceLabel}</span>}
                        </span>
                        {c.description && <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600">{c.description}</span>}
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

// ── shared bits ───────────────────────────────────────────────────────────────
function Row({ icon, tint, title, sub, chevron, divider, onClick }: { icon: React.ReactNode; tint: string; title: string; sub: string; chevron?: boolean; divider?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-900 ${divider ? "border-t border-zinc-800" : ""}`}
    >
      <span className={`shrink-0 ${tint}`}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-mono text-[11px] text-zinc-200">{title}</span>
        <span className="truncate font-mono text-[10px] text-zinc-600">{sub}</span>
      </span>
      {chevron && (
        <svg className="shrink-0 text-zinc-600" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
    </button>
  );
}

function DrawerHeader({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div className="flex items-center gap-2 px-2.5 pb-1 pt-0.5">
      <BackButton onBack={onBack} />
      <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
    </div>
  );
}

function SearchHeader({ inputRef, value, onChange, onBack, placeholder }: { inputRef: React.RefObject<HTMLInputElement | null>; value: string; onChange: (v: string) => void; onBack: () => void; placeholder: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-2.5 py-2">
      <BackButton onBack={onBack} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-300">
          ✕
        </button>
      )}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} aria-label="Back" className="shrink-0 text-zinc-500 transition-colors hover:text-zinc-200">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </svg>
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 py-3 font-mono text-[10px] text-zinc-600">{children}</p>;
}

const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);
const TodoIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="6" height="6" rx="1" />
    <path d="m3 17 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </svg>
);
const CommandIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
  </svg>
);
