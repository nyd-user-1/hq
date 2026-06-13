"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// The right "app panel": a slide-in column portaled into #app-panel-root (a flex
// sibling of the terminal inside the shell). Open/closed + width are driven by
// props; the content (a parallel-route slot) brings its own boundary chip, so
// this stays minimal chrome — just the slide mechanics + close/expand controls.
export default function AppPanel({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [root, setRoot] = useState<Element | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setRoot(document.getElementById("app-panel-root"));
  }, []);
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  if (!root) return null;

  const w = expanded ? "sm:w-[46vw]" : "sm:w-[420px]";

  return createPortal(
    <div
      // clip-path (not overflow-hidden) clips the sides/bottom for the width
      // slide while leaving a 12px opening at the TOP — so the boundary chip can
      // poke up onto the line and the box top sits FLUSH with the sidebar/
      // terminal boxes. Same trick SidebarColumn uses; overflow-hidden + pt-3
      // was what dropped this column 12px below the other two.
      className={`h-full shrink-0 [clip-path:inset(-12px_0px_0px_0px)] transition-all duration-300 ease-in-out ${
        open ? `w-full ${w} sm:ml-4` : "w-0"
      }`}
    >
      {open && (
        <div className="relative flex h-full w-full flex-col">
          {/* controls resting ON the boundary line, opposite the path chip —
              at -top-2.5 (−10px) like the path chip, poking up through the
              clip-path's 12px top opening */}
          <div className="absolute right-3 -top-2.5 z-10 flex gap-1.5">
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse to a third" : "Expand to half"}
              className="flex shrink-0 items-center bg-zinc-800 px-1.5 py-0.5 text-zinc-400 transition-colors hover:text-zinc-100"
            >
              {/* columns icon shows the TARGET layout: Columns2 (→ half) when
                  collapsed, Columns3 (→ third) when expanded */}
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
                <rect width="18" height="18" x="3" y="3" rx="2" />
                {expanded ? (
                  <>
                    <path d="M9 3v18" />
                    <path d="M15 3v18" />
                  </>
                ) : (
                  <path d="M12 3v18" />
                )}
              </svg>
            </button>
            <button
              onClick={onClose}
              aria-label="Close panel"
              className="flex shrink-0 items-center bg-zinc-800 px-1.5 py-0.5 text-zinc-400 transition-colors hover:text-zinc-100"
            >
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
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* -mt-3 lifts the scroll box so its boundary box sits flush at the
              column top (level with sidebar/terminal); pt-3 keeps the chip clear
              of overflow-y's own top edge; +12px height holds the bottom flush. */}
          <div className="scrollbar-none -mt-3 flex h-[calc(100%_+_0.75rem)] min-h-0 shrink-0 flex-col overflow-y-auto pt-3">
            {children}
          </div>
        </div>
      )}
    </div>,
    root
  );
}
