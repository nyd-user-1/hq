"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Boundary from "@/app/ui/boundary";
import ButtonChipIcon from "@/app/ui/button-chip-icon";
import { useTextEditor } from "@/app/ui/text-editor-state";

// The full-screen Text capture editor — an 800×500 dialog (responsive) centered
// over a gaussian-blurred backdrop, anchored to <body> so it floats above the
// whole shell. You paste a body of text, hit ↵, and it POSTs to /api/notes → a
// searchable HQ note (the same store the "save as a note" button writes). The
// first non-empty line becomes the title (lib/notes `noteTitle`), so no title
// field.
//
// Keys, Claude-chat style: ↵ saves · ⇧↵ newline. Click ANYWHERE but the textarea
// (backdrop, chrome, esc, the close X) dismisses — and if there's text it's saved
// on the way out, never dropped. The blurred backdrop both signals the modal and
// catches a stray click as a one-tap exit.
export default function TextEditor() {
  const { open, setOpen, text, setText, clear } = useTextEditor();
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setMounted(true), []);

  // Focus the textarea + reset transient status whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSavedName(null);
    setSaving(false);
    const id = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Lock body scroll while the dialog is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const stats = useMemo(() => {
    const trimmed = text.trim();
    const title = (text.split("\n").find((l) => l.trim()) || "").trim().slice(0, 60);
    return {
      chars: text.length,
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      lines: text ? text.split("\n").length : 0,
      title,
    };
  }, [text]);

  async function save() {
    const body = text.trim();
    if (!body || saving || savedName) return;
    setSaving(true);
    setError(null);
    try {
      // Pin provenance to the session in the URL if one's there (best-effort).
      const sessionId =
        new URLSearchParams(window.location.search).get("session") || undefined;
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body, role: "user", sessionId }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      setSavedName(data?.name ?? "saved");
      clear(); // empties the editor + drops the persisted draft
      // Hold the "saved ✓" beat so it's clear what happened, then close.
      window.setTimeout(() => setOpen(false), 850);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  // Any exit path: save the text on the way out (never lose a paste), else just
  // close. Used by the backdrop/chrome click, the close X, and esc.
  function dismiss() {
    if (text.trim()) save();
    else setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // ↵ saves; ⇧↵ inserts a newline (Claude-chat style).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Text capture editor"
      // Click anywhere that ISN'T flagged data-keep (the textarea + the action
      // controls) dismisses. mousedown (not click) so a drag-select that ends
      // outside the textarea doesn't trip it.
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-keep]")) return;
        dismiss();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          dismiss();
        }
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md sm:p-6"
    >
      <div className="relative flex h-[500px] max-h-[90vh] w-[800px] max-w-[92vw] flex-col rounded-lg bg-zinc-950 shadow-2xl">
        {/* close chip resting on the dashed top line, top-RIGHT corner. data-keep
            so the backdrop handler doesn't double-fire; its own onClick dismisses
            (saving any text on the way out). */}
        <div className="absolute right-3 -top-2.5 z-10" data-keep>
          <ButtonChipIcon
            onClick={dismiss}
            label="Close text editor"
            title="Close (esc)"
            className="shrink-0 boundary-flash-chip"
            icon={
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
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            }
          />
        </div>

        {/* Boundary IS the frame — its dashed rounded-lg border is the card edge
            (no competing solid ring), matching every other panel in HQ. */}
        <Boundary label="text-editor.tsx">
          <p className="-mt-1 font-mono text-[11px] text-zinc-500">
            Paste or type a body of text — the first line becomes its title.{" "}
            <span className="text-zinc-600">It saves as a searchable HQ note.</span>
          </p>

          <textarea
            ref={taRef}
            data-keep
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Paste your text here, then ↵ to save…"
            spellCheck={false}
            className="min-h-0 w-full flex-1 resize-none rounded-lg bg-zinc-900/50 p-4 text-[15px] leading-relaxed text-zinc-100 ring-1 ring-zinc-800/60 transition-colors placeholder:text-zinc-600 focus:outline-none focus:ring-zinc-700/70"
          />

          {/* footer: live counts + status (left) · keys + save (right) */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-zinc-800 pt-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              {savedName ? (
                <span className="text-emerald-400">saved ✓ → {savedName}</span>
              ) : error ? (
                <span className="text-red-400">save failed — {error}</span>
              ) : (
                <span>
                  {stats.words} words · {stats.chars} chars · {stats.lines} lines
                  {stats.title && (
                    <span className="ml-2 text-zinc-600">
                      title: “{stats.title}”
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden font-mono text-[10px] text-zinc-600 sm:inline">
                ↵ save · ⇧↵ newline · esc close
              </span>
              <button
                data-keep
                onClick={save}
                disabled={!text.trim() || saving || !!savedName}
                className="rounded-md bg-orange-500/90 px-3.5 py-1.5 font-mono text-[11px] font-medium text-zinc-950 transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                {savedName ? "saved ✓" : saving ? "saving…" : "save note"}
              </button>
            </div>
          </div>
        </Boundary>
      </div>
    </div>,
    document.body
  );
}
