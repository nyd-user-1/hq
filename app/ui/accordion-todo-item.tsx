"use client";

import Markdown from "@/app/ui/md";
import MetaChipRow from "@/app/ui/meta-chip-row";
import AccordionItem from "@/app/ui/accordion-item";
import { CAT_BY_KEY } from "@/app/ui/todo-categories";
import type { TodoItem } from "@/lib/todo";

// One collapsible To Do card — a thin wrapper over the generic AccordionItem
// that maps a TodoItem to it: provenance (● who · time · category), the numbered
// draggable title, a done checkbox (trailing), and a body of markdown + a
// MetaChipRow footer. TodoList owns the state and passes the callbacks.
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
  const expandable = !!t.body || !!sess;
  const isSession = !!t.addedBy && t.addedBy !== "you";
  const who = t.addedBy === "you" ? "you" : isSession ? "claude" : "added";
  const dotClass =
    t.addedBy === "you"
      ? "text-blue-500"
      : isSession
        ? "text-orange-500"
        : "text-zinc-600";
  const cat = t.category ? CAT_BY_KEY[t.category] : undefined;

  return (
    <AccordionItem
      who={who}
      dotClass={dotClass}
      meta={new Date(t.createdAt).toLocaleTimeString()}
      tag={cat ? { label: cat.label, chipClass: cat.chip } : undefined}
      claimedBy={t.claimedBy}
      index={index + 1}
      label={t.text}
      done={t.done}
      expandable={expandable}
      open={open}
      onToggleExpand={onToggleExpand}
      copied={copied}
      onCopy={onCopy}
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
      {(t.body || sess) && (
        <>
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
        </>
      )}
    </AccordionItem>
  );
}
