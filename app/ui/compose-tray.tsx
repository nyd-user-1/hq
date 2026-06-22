"use client";

import { useState } from "react";

// A collected artifact: `label` shows in the chip, `ref` is what gets injected
// (a to-do's text, a memory @path, a commit sha, …).
type Chip = { id: string; label: string; ref: string };

// Drag payloads the tray accepts. Future source cards (memory/commit/file) emit
// ART_TYPE as JSON {label, ref}; to-do cards emit TODO_TYPE (the text); anything
// else falls back to text/plain.
const ART_TYPE = "application/x-hq-artifact";
const TODO_TYPE = "application/x-hq-todo";

// Compose foundation: gather artifacts here, then Send drops the assembled refs
// into Terminal 1's message box (via the hq:compose window event the terminal
// listens for). Source cards become draggable in later sub-tasks; for now drop
// any draggable text or use the manual add to exercise the flow.
export default function ComposeTray() {
  const [chips, setChips] = useState<Chip[]>([]);
  const [over, setOver] = useState(false);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);

  const addChip = (label: string, ref: string) =>
    setChips((c) => [...c, { id: crypto.randomUUID(), label: label || ref, ref }]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const dt = e.dataTransfer;
    const art = dt.getData(ART_TYPE);
    if (art) {
      try {
        const { label, ref } = JSON.parse(art);
        if (ref) return addChip(label, ref);
      } catch {
        /* fall through */
      }
    }
    const todo = dt.getData(TODO_TYPE);
    if (todo) return addChip(todo, todo);
    const text = dt.getData("text/plain");
    if (text.trim()) addChip(text.trim(), text.trim());
  }

  function send() {
    if (!chips.length) return;
    const text = chips.map((c) => c.ref).join("\n");
    window.dispatchEvent(new CustomEvent("hq:compose", { detail: { text } }));
    setSent(true);
    setTimeout(() => setSent(false), 1500);
    setChips([]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-xs leading-relaxed text-zinc-500">
        Gather artifacts, then send them into the terminal as one prompt — the
        output side stays yours to review and fire.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex min-h-28 flex-col rounded-md border-2 border-dashed p-2 transition-colors ${
          over ? "border-sky-500 bg-sky-500/5" : "border-zinc-800"
        }`}
      >
        {chips.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center text-xs text-zinc-600">
            <span>drag artifacts here — memory, commits, files, to-dos</span>
            <span className="text-[11px] text-zinc-700">
              (sources come online as each becomes draggable)
            </span>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {chips.map((c, i) => (
              <li
                key={c.id}
                className="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-xs"
              >
                <span className="shrink-0 font-mono text-zinc-600">{i + 1}.</span>
                <span
                  className="min-w-0 flex-1 truncate text-zinc-300"
                  title={c.ref}
                >
                  {c.label}
                </span>
                <button
                  onClick={() =>
                    setChips((cs) => cs.filter((x) => x.id !== c.id))
                  }
                  aria-label="Remove"
                  className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-200"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            addChip(draft.trim(), draft.trim());
            setDraft("");
          }
        }}
        placeholder="add a line — @path, a sha, or text — ↵"
        className="rounded-md border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={send}
          disabled={!chips.length}
          className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sent
            ? "sent ✓"
            : `Send to terminal${chips.length ? ` (${chips.length})` : ""}`}
        </button>
        {chips.length > 0 && (
          <button
            onClick={() => setChips([])}
            className="text-xs text-zinc-600 transition-colors hover:text-zinc-300"
          >
            clear
          </button>
        )}
      </div>

      <p className="text-[11px] text-zinc-600">
        drops into Terminal 1&apos;s message box — review and send from there.
      </p>
    </div>
  );
}
