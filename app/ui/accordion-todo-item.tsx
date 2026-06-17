"use client";

import Markdown from "@/app/ui/md";
import MetaChipRow from "@/app/ui/meta-chip-row";
import AccordionItem, { CopyGlyph } from "@/app/ui/accordion-item";
import { CAT_BY_KEY } from "@/app/ui/todo-categories";
import type { TodoItem } from "@/lib/todo";

// lucide "pencil" — the body's edit-in-place affordance.
const PencilGlyph = () => (
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
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

// One collapsible To Do card — a thin wrapper over the generic AccordionItem
// that maps a TodoItem to it: provenance (● who · category), a draggable title,
// a done checkbox (trailing), and a body of markdown + a MetaChipRow footer. The
// copy lives in the body's top-right (like the Components cards); the created-at
// time sits at the end of the meta row as "at <time>". TodoList owns the state.
export default function AccordionTodoItem({
  item,
  open,
  copied,
  reorderEnabled,
  dragSourceId,
  dropEdge,
  showTag = false,
  editing = false,
  editValue = "",
  onEditChange,
  onEditCommit,
  onEditCancel,
  onToggleExpand,
  onToggleDone,
  onCopy,
  onDragStart,
  onDragEnd,
  onDragOverEdge,
  onDropEdge,
  bodyEditing = false,
  bodyDraft = "",
  onBodyEditStart,
  onBodyChange,
  onBodyCommit,
  onBodyCancel,
}: {
  item: TodoItem;
  open: boolean;
  copied: boolean;
  reorderEnabled: boolean;
  dragSourceId: string | null;
  dropEdge: "before" | "after" | null;
  showTag?: boolean; // show the category badge atop the card (when a filter is active)
  editing?: boolean; // inline title edit (freshly added "+" todo)
  editValue?: string;
  onEditChange?: (v: string) => void;
  onEditCommit?: () => void;
  onEditCancel?: () => void;
  onToggleExpand: () => void;
  onToggleDone: () => void;
  onCopy: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverEdge: (pos: "before" | "after") => void;
  onDropEdge: (pos: "before" | "after") => void;
  bodyEditing?: boolean; // editing the markdown body in place
  bodyDraft?: string;
  onBodyEditStart?: () => void;
  onBodyChange?: (v: string) => void;
  onBodyCommit?: () => void;
  onBodyCancel?: () => void;
}) {
  const t = item;
  const sess =
    t.fromSession || (t.addedBy && t.addedBy !== "you" ? t.addedBy : null);
  // Every to-do now has body content — at minimum the "at <time>" meta row — so
  // they're all expandable.
  const expandable = true;
  const isSession = !!t.addedBy && t.addedBy !== "you";
  const who = t.addedBy === "you" ? "you" : isSession ? "claude" : "added";
  const dotClass =
    t.addedBy === "you"
      ? "text-blue-500"
      : isSession
        ? "text-orange-500"
        : "text-zinc-600";
  // Category badge — only when the list is filtered to a category (showTag).
  const cat = showTag && t.category ? CAT_BY_KEY[t.category] : undefined;

  // The created-at time now sits at the END of the meta row ("at <time>")
  // rather than in the provenance header.
  const atChip = {
    label: "at",
    value: new Date(t.createdAt).toLocaleTimeString(),
  };
  const metaItems = sess
    ? [
        { label: "Task", value: t.id },
        { label: "via session", value: sess.slice(0, 8), copyText: sess },
        atChip,
      ]
    : t.addedBy === "you"
      ? [{ label: "Task", value: t.id }, { label: "via", value: "user" }, atChip]
      : [atChip];

  return (
    <AccordionItem
      who={who}
      dotClass={dotClass}
      tag={cat ? { label: cat.label, chipClass: cat.chip } : undefined}
      claimedBy={t.claimedBy}
      label={t.text}
      labelEditor={
        editing ? (
          <input
            autoFocus
            value={editValue}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEditCommit?.();
              if (e.key === "Escape") onEditCancel?.();
            }}
            onBlur={() => onEditCommit?.()}
            placeholder="name this to-do — ↵ save · esc cancel"
            className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
        ) : undefined
      }
      done={t.done}
      expandable={expandable}
      open={open}
      onToggleExpand={onToggleExpand}
      dragText={t.text}
      dragId={t.id}
      dragSourceId={dragSourceId}
      dropEdge={dropEdge}
      reorderEnabled={reorderEnabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOverEdge={onDragOverEdge}
      onDropEdge={onDropEdge}
      leading={
        t.done ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleDone();
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
              onToggleDone();
            }}
            title="mark done"
            aria-label="Mark done"
            className="size-4 shrink-0 rounded-[3px] border border-zinc-600 transition-colors hover:border-green-500 hover:bg-green-500/20"
          />
        )
      }
    >
      {expandable && (
        <div className="group/body relative">
          {bodyEditing ? (
            <textarea
              autoFocus
              value={bodyDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onBodyChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onBodyCancel?.();
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onBodyCommit?.();
                }
              }}
              onBlur={() => onBodyCommit?.()}
              placeholder="add details — markdown ok · ⌘↵ save · esc cancel"
              rows={4}
              className="w-full resize-y rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          ) : (
            <>
              {/* edit-in-place + copy affordances, top-right of the body */}
              <div className="absolute right-0 top-0 z-10 flex items-center gap-1 opacity-0 transition focus-within:opacity-100 group-hover/body:opacity-100">
                <button
                  onClick={() => onBodyEditStart?.()}
                  title="edit details"
                  aria-label="Edit details"
                  className="rounded bg-zinc-900/80 p-1 text-zinc-500 transition hover:text-zinc-200"
                >
                  <PencilGlyph />
                </button>
                <button
                  onClick={onCopy}
                  title="copy"
                  aria-label="Copy to-do"
                  className="rounded bg-zinc-900/80 p-1 text-zinc-500 transition hover:text-zinc-200"
                >
                  {copied ? (
                    <span className="text-[10px] text-green-400">✓</span>
                  ) : (
                    <CopyGlyph />
                  )}
                </button>
              </div>
              {t.body ? (
                <Markdown text={t.body} />
              ) : (
                <button
                  onClick={() => onBodyEditStart?.()}
                  className="italic text-zinc-600 transition-colors hover:text-zinc-400"
                >
                  add details…
                </button>
              )}
            </>
          )}
          <MetaChipRow divider={!!t.body || bodyEditing} items={metaItems} />
        </div>
      )}
    </AccordionItem>
  );
}
