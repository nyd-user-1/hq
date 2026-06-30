"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useTextEditor } from "@/app/ui/text-editor-state";

// The Text capture editor, re-homed from a centered modal into a standalone
// push-in panel (the skills-panel standard: an AppPanel portal into its own
// #text-editor-panel-root). Same guts as the old dialog — paste or type a body
// of text, hit ↵, and it POSTs to /api/notes → a searchable HQ note (the first
// non-empty line becomes the title, lib/notes `noteTitle`, so no title field).
// In EDIT mode (the ⌘K reader's pencil → openEdit) it writes the raw content
// straight back to its file via /api/file-edit.
//
// Keys, Claude-chat style: ↵ saves · ⇧↵ newline · esc closes. AppPanel now owns
// the slide-in frame + the close/expand controls, so the modal backdrop, body
// scroll-lock, and the close-X chip are gone — the editor guts are unchanged.
export default function TextEditorPanel() {
  const { open, setOpen, text, setText, clear, editTarget, closeEdit } = useTextEditor();
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea + reset transient status whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSavedName(null);
    setSaving(false);
    const id = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(id);
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
    if (saving || savedName || !text.trim()) return;
    setSaving(true);
    setError(null);

    // Edit mode: write the raw content straight back to the file it came from.
    if (editTarget) {
      try {
        const res = await fetch("/api/file-edit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: editTarget.kind,
            ref: editTarget.ref,
            content: text,
          }),
        });
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        setSavedName(editTarget.title || editTarget.ref);
        // Tell the ⌘K reader to re-fetch the file it's showing.
        window.dispatchEvent(
          new CustomEvent("hq:file-edited", {
            detail: { kind: editTarget.kind, ref: editTarget.ref },
          })
        );
        window.setTimeout(() => {
          closeEdit(); // restore the scratch draft
          setOpen(false);
        }, 850);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      }
      return;
    }

    try {
      // Pin provenance to the session in the URL if one's there (best-effort).
      const sessionId =
        new URLSearchParams(window.location.search).get("session") || undefined;
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: text.trim(), role: "user", sessionId }),
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

  // Exit. New-note mode auto-saves on the way out (never lose a paste). EDIT mode
  // does NOT — closing must never silently overwrite a file — so it just discards
  // the unsaved edits and restores the scratch draft. Wired to AppPanel's close.
  function dismiss() {
    if (editTarget) {
      closeEdit();
      setOpen(false);
      return;
    }
    if (text.trim()) save();
    else setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // ↵ saves; ⇧↵ inserts a newline (Claude-chat style). esc closes.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    }
  }

  return (
    <AppPanel
      rootId="text-editor-panel-root"
      open={open}
      onClose={dismiss}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="text-editor-panel.tsx">
        <p className="-mt-1 font-mono text-[11px] text-zinc-500">
          {editTarget ? (
            <>
              Editing <span className="text-zinc-300">{editTarget.title}</span>{" "}
              <span className="text-zinc-600">
                — ↵ writes it straight back to the file (frontmatter and all).
              </span>
            </>
          ) : (
            <>
              Paste or type a body of text — the first line becomes its title.{" "}
              <span className="text-zinc-600">It saves as a searchable HQ note.</span>
            </>
          )}
        </p>

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            editTarget ? "Edit the file, then ↵ to save…" : "Paste your text here, then ↵ to save…"
          }
          spellCheck={false}
          className="scrollbar-none min-h-0 w-full flex-1 resize-none rounded-lg bg-zinc-900/50 p-4 text-[15px] leading-relaxed text-zinc-100 ring-1 ring-zinc-800/60 transition-colors placeholder:text-zinc-600 focus:outline-none focus:ring-zinc-700/70"
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
                {!editTarget && stats.title && (
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
              onClick={save}
              disabled={!text.trim() || saving || !!savedName}
              className="rounded-md bg-orange-500/90 px-3.5 py-1.5 font-mono text-[11px] font-medium text-zinc-950 transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              {savedName ? "saved ✓" : saving ? "saving…" : editTarget ? "save file" : "save note"}
            </button>
          </div>
        </div>
      </Boundary>
    </AppPanel>
  );
}
