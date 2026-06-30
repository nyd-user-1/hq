"use client";

import { useRef, useState } from "react";

const DND_TYPE = "application/x-hq-pane"; // matches boundary-chip's drag payload

// Makes a whole terminal pane a drop target for reorder — drag a terminal's chip
// and drop ANYWHERE on another pane (not just its chip). Shows a "move here" overlay
// while hovering and dispatches the same "hq:reorder-pane" event the chip does, so
// reorder-listener handles both paths. A depth counter keeps the overlay steady as
// the drag crosses child elements (plain dragleave flickers).
export default function PaneDropZone({
  slot,
  className = "",
  children,
}: {
  slot: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const has = (e: React.DragEvent) => e.dataTransfer.types.includes(DND_TYPE);
  return (
    <div
      // The pane's DEAD SPACE (the margins/padding around the conversation) is a drag
      // handle too — grab it like a window title bar. The conversation content is
      // marked draggable={false} (terminal.tsx), so a drag from it selects text;
      // a drag from the empty space walks up to here and moves the pane. cursor-grab
      // shows the affordance over that dead space.
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_TYPE, String(slot));
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`relative cursor-grab active:cursor-grabbing ${className}`}
      onDragEnter={(e) => {
        if (!has(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!has(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => {
        if (!has(e)) return;
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setOver(false);
        }
      }}
      onDrop={(e) => {
        if (!has(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const from = Number(e.dataTransfer.getData(DND_TYPE));
        if (Number.isFinite(from) && from !== slot) {
          window.dispatchEvent(
            new CustomEvent("hq:reorder-pane", { detail: { from, to: slot } }),
          );
        }
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-400/70 bg-blue-500/10">
          <span className="rounded bg-blue-600 px-2 py-1 font-mono text-[11px] text-white shadow-lg">
            move here
          </span>
        </div>
      )}
    </div>
  );
}
