"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The custom dark hover tooltip — a portaled chip that replaces the unstyleable
// native `title`. Portaled to <body> so it escapes any scroll/stacking context
// and floats over neighboring columns (the same reason sidebar-recents went
// custom). Look matches that tooltip: dark surface (bg-zinc-900 / border-
// zinc-700), zinc-200 mono at 11px.
//
// Wrap a trigger: <Tooltip label="Filter by user"><button…/></Tooltip>. The
// wrapper is inline-flex + shrink-0 so it slots into a flex toolbar row without
// disturbing layout.
//
// Positioning measures the chip after it mounts, anchors it to the preferred
// `placement`, then CLAMPS every edge into the viewport (8px gutter) so it can
// never spill off-screen — top/bottom auto-flip to the other side when the
// preferred one has no room. (Before this, position was pure CSS translate with
// no clamp: the panel-header "Wide screen" chip clipped off the right edge, and
// a `top` chip could land off-screen and read as "not rendering" at all.)

type Placement = "top" | "bottom" | "right";

const GUTTER = 8; // min distance kept from every viewport edge

export default function Tooltip({
  label,
  placement = "top",
  className,
  children,
}: {
  label: string;
  placement?: Placement;
  className?: string; // extends the wrapper (e.g. ml-auto) — it's the flex child now
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  // The trigger rect, captured on hover. While set, the chip is mounted (hidden)
  // so it can be measured; `pos` is the clamped result we actually paint at.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!anchor || !chipRef.current) return;
    const c = chipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (placement === "right") {
      left = anchor.right + GUTTER;
      top = anchor.top + anchor.height / 2 - c.height / 2;
    } else {
      left = anchor.left + anchor.width / 2 - c.width / 2; // centered on the trigger
      const above = anchor.top - GUTTER - c.height;
      const below = anchor.bottom + GUTTER;
      if (placement === "top")
        top = above >= GUTTER ? above : below; // flip below if there's no room above
      else top = below + c.height <= vh - GUTTER ? below : above; // flip above if none below
    }
    // Final clamp — keep the whole chip inside the viewport on both axes.
    left = Math.max(GUTTER, Math.min(left, vw - c.width - GUTTER));
    top = Math.max(GUTTER, Math.min(top, vh - c.height - GUTTER));
    setPos({ left, top });
  }, [anchor, placement]);

  const hide = () => {
    setAnchor(null);
    setPos(null);
  };

  return (
    <span
      ref={wrapRef}
      onMouseEnter={() => setAnchor(wrapRef.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={hide}
      className={`inline-flex shrink-0${className ? ` ${className}` : ""}`}
    >
      {children}
      {anchor &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={chipRef}
            role="tooltip"
            // Hidden until measured+clamped, so it never flashes at a wrong spot.
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              visibility: pos ? "visible" : "hidden",
            }}
            className="pointer-events-none fixed z-[100] whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] tracking-wide text-zinc-200 shadow-xl"
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
