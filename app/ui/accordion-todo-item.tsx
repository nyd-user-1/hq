"use client";

import Markdown from "@/app/ui/md";
import MetaChipRow from "@/app/ui/meta-chip-row";
import AccordionItem, { CopyGlyph } from "@/app/ui/accordion-item";
import { CAT_BY_KEY } from "@/app/ui/todo-categories";
import type { TodoItem } from "@/lib/todo";

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
  onToggleExpand,
  onToggleDone,
  onCopy,
  onDragStart,
  onDragEnd,
  onDragOverEdge,
  onDropEdge,
}: {
  item: TodoItem;
  open: boolean;
  copied: boolean;
  reorderEnabled: boolean;
  dragSourceId: string | null;
  dropEdge: "before" | "after" | null;
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
  const cat = t.category ? CAT_BY_KEY[t.category] : undefined;

  // The created-at time now sits at the END of the meta row ("at <time>")
  // rather than in the provenance header.
  const metaItems = [
    ...(sess
      ? [
          { label: "Task", value: t.id },
          { label: "via session", value: sess.slice(0, 8), copyText: sess },
        ]
      : []),
    { label: "at", value: new Date(t.createdAt).toLocaleTimeString() },
  ];

  return (
    <AccordionItem
      who={who}
      dotClass={dotClass}
      tag={cat ? { label: cat.label, chipClass: cat.chip } : undefined}
      claimedBy={t.claimedBy}
      label={t.text}
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
      trailing={
        t.done ? (
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
        )
      }
    >
      {expandable && (
        <div className="group/body relative">
          <button
            onClick={onCopy}
            title="copy"
            aria-label="Copy to-do"
            className="absolute right-0 top-0 z-10 rounded bg-zinc-900/80 p-1 text-zinc-500 opacity-0 transition hover:text-zinc-200 focus:opacity-100 group-hover/body:opacity-100"
          >
            {copied ? (
              <span className="text-[10px] text-green-400">✓</span>
            ) : (
              <CopyGlyph />
            )}
          </button>
          {t.body && <Markdown text={t.body} />}
          <MetaChipRow divider={!!t.body} items={metaItems} />
        </div>
      )}
    </AccordionItem>
  );
}
