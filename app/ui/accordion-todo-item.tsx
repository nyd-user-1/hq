"use client";

import type { DragEvent } from "react";
import Markdown from "@/app/ui/md";
import MetaChipRow from "@/app/ui/meta-chip-row";
import { CAT_BY_KEY } from "@/app/ui/todo-categories";
import type { TodoItem } from "@/lib/todo";

// Drag marker — must match TODO_DND_TYPE in terminal.tsx.
const TODO_DND_TYPE = "application/x-hq-todo";
// Carries the item id during a row drag → dropping on another row reorders.
// (A drop on a terminal reads TODO_DND_TYPE/text and injects instead — the drop
// target decides; one drag serves both.)
const TODO_ID_TYPE = "application/x-hq-todo-id";

// lucide "copy" — hover-revealed copy affordance.
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

// One collapsible To Do card: a provenance header (● who · time · category ·
// claimed) above a bordered disclosure that expands to render the body as
// markdown + a MetaChipRow footer. Fully controlled/presentational — TodoList
// owns the list state and hands every interaction back via callbacks. Title =
// drag into a terminal; checkbox (right) = toggle; hover copy = copy; click row
// = expand; drag a row over another reorders.
export default function AccordionTodoItem({
  item,
  index,
  open,
  copied,
  reorderEnabled,
  dragSourceId,
  dropEdge,
  onToggleExpand,
  onToggleDone,
  onCopy,
  onDragStart,
  onDragEnd,
  onDragOverEdge,
  onDropEdge,
}: {
  item: TodoItem;
  index: number;
  open: boolean;
  copied: boolean;
  reorderEnabled: boolean; // category filter is off → reorder DnD allowed
  dragSourceId: string | null; // the row currently being dragged (self/active checks)
  dropEdge: "before" | "after" | null; // show the drop indicator on this row
  onToggleExpand: () => void;
  onToggleDone: () => void;
  onCopy: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverEdge: (pos: "before" | "after") => void;
  onDropEdge: (pos: "before" | "after") => void;
}) {
  const t = item;
  const sess =
    t.fromSession || (t.addedBy && t.addedBy !== "you" ? t.addedBy : null);
  const expandable = !!t.body || !!sess;
  const dragging = dragSourceId === t.id;
  const reordering = !!dragSourceId;

  const isSession = !!t.addedBy && t.addedBy !== "you";
  const who = t.addedBy === "you" ? "you" : isSession ? "claude" : "added";
  const dot =
    t.addedBy === "you"
      ? "text-blue-500"
      : isSession
        ? "text-orange-500"
        : "text-zinc-600";

  const edge = (e: DragEvent<HTMLLIElement>): "before" | "after" => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? "before" : "after";
  };

  return (
    <li
      className={`relative flex flex-col gap-1.5 transition-opacity ${
        dragging ? "opacity-40" : ""
      }`}
      onDragOver={(e) => {
        if (!reorderEnabled || !reordering || dragging) return;
        e.preventDefault();
        onDragOverEdge(edge(e));
      }}
      onDrop={(e) => {
        if (!reorderEnabled || !reordering) return;
        e.preventDefault();
        onDropEdge(edge(e));
      }}
    >
      {dropEdge === "before" && (
        <span className="pointer-events-none absolute inset-x-0 -top-1.5 h-0.5 rounded bg-sky-500" />
      )}
      <div className="flex items-center px-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        <span className={`mr-1.5 normal-case ${dot}`}>●</span>
        {who}
        <span className="ml-2 normal-case tracking-normal text-zinc-600">
          {new Date(t.createdAt).toLocaleTimeString()}
        </span>
        {t.category && CAT_BY_KEY[t.category] && (
          <span
            className={`ml-auto rounded px-1 normal-case tracking-normal ${CAT_BY_KEY[t.category].chip}`}
          >
            {CAT_BY_KEY[t.category].label}
          </span>
        )}
        {t.claimedBy && (
          <span
            title={`claimed by session ${t.claimedBy}`}
            className={`rounded bg-amber-500/15 px-1 normal-case tracking-normal text-amber-300/90 ${
              t.category ? "ml-2" : "ml-auto"
            }`}
          >
            {t.claimedBy.slice(0, 8)}
          </span>
        )}
      </div>
      <div className="group/card rounded-md border border-zinc-800 bg-zinc-900/30">
        <div
          className={`flex items-center gap-2.5 px-3 py-1.5 ${
            expandable ? "cursor-pointer" : ""
          }`}
          onClick={expandable ? onToggleExpand : undefined}
        >
          <span
            className={`shrink-0 select-none text-[10px] text-zinc-100 transition-transform ${
              open ? "rotate-90" : ""
            } ${expandable ? "" : "invisible"}`}
          >
            ▶
          </span>
          <span className="shrink-0 font-mono text-xs text-zinc-600">
            {index + 1}.
          </span>
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TODO_DND_TYPE, t.text);
              e.dataTransfer.setData("text/plain", t.text);
              e.dataTransfer.setData(TODO_ID_TYPE, t.id);
              e.dataTransfer.effectAllowed = "copyMove";
              onDragStart();
            }}
            onDragEnd={onDragEnd}
            title={t.text}
            className={`min-w-0 cursor-grab truncate text-xs active:cursor-grabbing ${
              t.done ? "text-zinc-600 line-through" : "text-zinc-200"
            }`}
          >
            {t.text}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            title="copy"
            className="shrink-0 p-0 text-zinc-600 opacity-0 transition hover:text-zinc-200 focus:opacity-100 group-hover/card:opacity-100"
          >
            {copied ? (
              <span className="text-green-400">✓</span>
            ) : (
              <CopyGlyph />
            )}
          </button>
          {t.done ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleDone();
              }}
              title="mark not done"
              aria-label="Mark not done"
              className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-green-600/70 bg-green-600/30 text-[10px] leading-none text-green-400 transition-colors hover:bg-green-600/40"
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
              className="ml-auto size-4 shrink-0 rounded-[3px] border border-zinc-600 transition-colors hover:border-green-500 hover:bg-green-500/20"
            />
          )}
        </div>
        {open && (t.body || sess) && (
          <div className="border-t border-zinc-800 px-3.5 py-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {t.body && <Markdown text={t.body} />}
            {sess && (
              <MetaChipRow
                divider={!!t.body}
                items={[
                  { label: "Task", value: t.id },
                  {
                    label: "via session",
                    value: sess.slice(0, 8),
                    copyText: sess,
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>
      {dropEdge === "after" && (
        <span className="pointer-events-none absolute inset-x-0 -bottom-1.5 h-0.5 rounded bg-sky-500" />
      )}
    </li>
  );
}
