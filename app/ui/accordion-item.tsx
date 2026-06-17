"use client";

import type { DragEvent, ReactNode } from "react";

// Drag marker — must match TODO_DND_TYPE in terminal.tsx (the terminal's drop
// handler reads this + text to inject into its send box).
const DND_TYPE = "application/x-hq-todo";
// Carries the drag id during a row drag → dropping on a sibling reorders.
const DND_ID_TYPE = "application/x-hq-todo-id";

// lucide "copy" — hover-revealed copy affordance.
export const CopyGlyph = () => (
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

export type AccordionTag = { label: string; chipClass: string };

// A generic collapsible card in HQ's tool-step language: an optional provenance
// header (● who · meta · tag) above a bordered disclosure (rotating ▶, optional
// number, draggable label, hover-copy, optional `trailing` control) that expands
// to reveal `children`. Drag the label into a terminal (drops `dragText`) or onto
// a sibling card to reorder. Fully controlled/presentational — the list owns the
// state and passes interaction callbacks. Shared by AccordionTodoItem (To Do)
// and the Components registry.
export default function AccordionItem({
  who,
  dotClass = "text-zinc-600",
  meta,
  tag,
  claimedBy,
  index,
  label,
  labelEditor,
  done = false,
  fillLabel = false,
  wrapLabel = false,
  expandable,
  open,
  onToggleExpand,
  copied = false,
  onCopy,
  leading,
  trailing,
  children,
  dragText,
  dragId,
  dragSourceId,
  dropEdge,
  reorderEnabled,
  onDragStart,
  onDragEnd,
  onDragOverEdge,
  onDropEdge,
}: {
  // provenance header — rendered when `who` is set
  who?: string;
  dotClass?: string;
  meta?: string; // muted middle text (a timestamp, a file path…)
  tag?: AccordionTag; // right-aligned pill (a category / kind)
  claimedBy?: string;
  // disclosure
  index?: number; // optional leading number; omit to hide
  label: string; // the draggable title
  labelEditor?: ReactNode; // when set, replaces the title span (inline rename input)
  done?: boolean; // strike-through styling
  fillLabel?: boolean; // label flex-grows (no trailing control → copy sits right)
  wrapLabel?: boolean; // let the title wrap instead of truncating (responsive rows)
  expandable: boolean;
  open: boolean;
  onToggleExpand: () => void;
  copied?: boolean; // header copy button only renders when onCopy is given
  onCopy?: () => void;
  leading?: ReactNode; // sits before the triangle (e.g. a checkbox)
  trailing?: ReactNode; // sits at the end; position it with ml-auto
  children?: ReactNode; // body, shown when open
  // drag-to-terminal + reorder
  dragText: string;
  dragId: string;
  dragSourceId: string | null;
  dropEdge: "before" | "after" | null;
  reorderEnabled: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverEdge: (pos: "before" | "after") => void;
  onDropEdge: (pos: "before" | "after") => void;
}) {
  const dragging = dragSourceId === dragId;
  const reordering = !!dragSourceId;
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
      {who && (
        <div className="flex items-center px-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          <span className={`mr-1.5 normal-case ${dotClass}`}>●</span>
          <span className="shrink-0">{who}</span>
          {meta && (
            <span className="ml-2 min-w-0 truncate normal-case tracking-normal text-zinc-600">
              {meta}
            </span>
          )}
          {tag && (
            <span
              className={`ml-auto shrink-0 rounded px-1 normal-case tracking-normal ${tag.chipClass}`}
            >
              {tag.label}
            </span>
          )}
          {claimedBy && (
            <span
              title={`claimed by session ${claimedBy}`}
              className={`shrink-0 rounded bg-amber-500/15 px-1 normal-case tracking-normal text-amber-300/90 ${
                tag ? "ml-2" : "ml-auto"
              }`}
            >
              {claimedBy.slice(0, 8)}
            </span>
          )}
        </div>
      )}
      <div className="group/card rounded-md border border-zinc-800 bg-zinc-900/30">
        <div
          className={`flex items-center gap-2.5 px-3 py-1.5 ${
            expandable ? "cursor-pointer" : ""
          }`}
          onClick={expandable ? onToggleExpand : undefined}
        >
          {leading}
          <span
            className={`shrink-0 select-none text-[10px] text-zinc-100 transition-transform ${
              open ? "rotate-90" : ""
            } ${expandable ? "" : "invisible"}`}
          >
            ▶
          </span>
          {index != null && (
            <span className="shrink-0 font-mono text-xs text-zinc-600">
              {index}.
            </span>
          )}
          {labelEditor ?? (
            <span
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DND_TYPE, dragText);
                e.dataTransfer.setData("text/plain", dragText);
                e.dataTransfer.setData(DND_ID_TYPE, dragId);
                e.dataTransfer.effectAllowed = "copyMove";
                onDragStart();
              }}
              onDragEnd={onDragEnd}
              title={label}
              className={`min-w-0 ${fillLabel ? "flex-1 " : ""}${
                wrapLabel ? "break-words" : "truncate"
              } cursor-grab text-xs active:cursor-grabbing ${
                done ? "text-zinc-600 line-through" : "text-zinc-200"
              }`}
            >
              {label}
            </span>
          )}
          {onCopy && (
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
          )}
          {trailing}
        </div>
        {open && children && (
          <div className="border-t border-zinc-800 px-3.5 py-3 font-mono text-[11px] leading-relaxed text-zinc-300">
            {children}
          </div>
        )}
      </div>
      {dropEdge === "after" && (
        <span className="pointer-events-none absolute inset-x-0 -bottom-1.5 h-0.5 rounded bg-sky-500" />
      )}
    </li>
  );
}
