"use client";

import { useRef, useState } from "react";

const DND_TYPE = "application/x-hq-pane"; // matches boundary-chip's drag payload

// Drag HANDLES live only on the boundary's padding ring (top / bottom / left /
// right), so a drag from the edge moves the pane while the conversation has NO
// draggable ancestor and stays fully selectable. The whole pane is still a drop
// TARGET (the root handlers), showing a "move here" overlay while another pane
// hovers it; both dispatch the same "hq:reorder-pane" event.
const EDGES = [
  "top-0 left-0 right-0 h-7", // top padding (pt-7)
  "bottom-0 left-0 right-0 h-4 sm:h-5", // bottom padding (pb-4/5)
  "top-7 bottom-4 sm:bottom-5 left-0 w-4 sm:w-5", // left padding (px-4/5)
  "top-7 bottom-4 sm:bottom-5 right-0 w-4 sm:w-5", // right padding
];

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
      className={`relative ${className}`}
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
      {/* Edge drag handles — z-10 sits above the conversation but below the chips
          (z-20), so chips stay clickable and the padding ring is the grab zone. */}
      {EDGES.map((pos) => (
        <div
          key={pos}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_TYPE, String(slot));
            e.dataTransfer.effectAllowed = "move";
          }}
          className={`absolute z-10 cursor-grab active:cursor-grabbing ${pos}`}
          aria-hidden
        />
      ))}
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
