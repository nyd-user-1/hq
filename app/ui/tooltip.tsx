"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The custom dark hover tooltip — a portaled chip that replaces the unstyleable
// native `title`. Portaled to <body> so it escapes any scroll/stacking context
// and floats over neighboring columns (the same reason sidebar-recents went
// custom). Look matches that tooltip: light surface (bg-zinc-900 / border-
// zinc-700), zinc-200 mono at 11px.
//
// Wrap a trigger: <Tooltip label="Filter by user"><button…/></Tooltip>. The
// wrapper is inline-flex + shrink-0 so it slots into a flex toolbar row without
// disturbing layout. Position is measured on hover (no scroll re-anchor, like
// the sidebar one).

type Placement = "top" | "bottom" | "right";

// per-placement translate: anchors the chip onto the point measured below
// (top = centered above, bottom = centered below, right = centered to the side).
const XLATE: Record<Placement, string> = {
  top: "-translate-x-1/2 -translate-y-full",
  bottom: "-translate-x-1/2",
  right: "-translate-y-1/2",
};

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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    if (placement === "right") setPos({ x: r.right + 8, y: r.top + r.height / 2 });
    else
      setPos({
        x: r.left + r.width / 2,
        y: placement === "top" ? r.top - 8 : r.bottom + 8,
      });
  };

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      className={`inline-flex shrink-0${className ? ` ${className}` : ""}`}
    >
      {children}
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: pos.y, left: pos.x }}
            className={`pointer-events-none fixed z-[100] ${XLATE[placement]} whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] tracking-wide text-zinc-200 shadow-xl`}
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
