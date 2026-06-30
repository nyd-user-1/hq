"use client";

import { useState } from "react";

// Shared chip shell — the boundary-line chip look. BoundaryChip (click-to-copy a
// path) wears this so every chip sitting on a boundary line is visually identical.
export const CHIP_CLASS =
  "boundary-flash-chip cursor-pointer bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:text-zinc-200";

const DND_TYPE = "application/x-hq-pane"; // carries the source slot during a reorder

// The file chip, clickable: one click copies a path verbatim — paste it straight
// into a Claude prompt or an editor's open-file box. `label` is what SHOWS (a
// filename or, for a component, its name, true-cased — no UPPERCASE transform);
// `copyText` is what's COPIED (the full repo-relative path) when it must differ
// from the display, so a chip can read `Terminal` yet copy `app/ui/terminal.tsx`.
export default function BoundaryChip({
  label,
  copyText,
  className = "",
  reorderSlot,
}: {
  label: string;
  copyText?: string;
  // Optional extra classes — lets a caller tint the chip (e.g. yellow while the
  // send box is in search mode). Appended last so `!` overrides win.
  className?: string;
  // When set, this chip is a TERMINAL handle: drag it onto another terminal's chip
  // to reorder/promote panes. Carries only a number through the (server) Boundary —
  // the reorder itself is done by a ReorderListener that hears the dispatched event,
  // so this shared chip needs no router/searchParams (keeps it prerender-safe).
  reorderSlot?: number;
}) {
  const [copied, setCopied] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  // Display the file name WITHOUT its extension (terminal.tsx → terminal); the
  // click-to-copy still copies the FULL path (extension kept) so it drops cleanly
  // into a terminal.
  const shown = label.replace(/\.tsx?$/, "");
  const drag =
    reorderSlot == null
      ? {}
      : {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData(DND_TYPE, String(reorderSlot));
            e.dataTransfer.effectAllowed = "move";
          },
          onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(DND_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropOver(true);
          },
          onDragLeave: () => setDropOver(false),
          onDrop: (e: React.DragEvent) => {
            setDropOver(false);
            const from = Number(e.dataTransfer.getData(DND_TYPE));
            if (!Number.isFinite(from) || from === reorderSlot) return;
            e.preventDefault();
            e.stopPropagation(); // don't also fire the pane drop zone underneath
            window.dispatchEvent(
              new CustomEvent("hq:reorder-pane", { detail: { from, to: reorderSlot } }),
            );
          },
        };
  return (
    <button
      {...drag}
      onClick={() => {
        navigator.clipboard.writeText(copyText ?? label);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={
        reorderSlot != null
          ? "drag onto another terminal to reorder · click to copy path"
          : copyText
            ? `click to copy ${copyText}`
            : "click to copy path"
      }
      className={`${CHIP_CLASS} min-w-0 truncate ${reorderSlot != null ? "cursor-grab active:cursor-grabbing" : ""} ${dropOver ? "ring-1 ring-blue-400" : ""} ${className}`}
    >
      {copied ? "copied ✓" : shown}
    </button>
  );
}
