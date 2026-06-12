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
      className={`h-full shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${
        open ? `w-full ${w} sm:ml-4` : "w-0"
      }`}
    >
      {open && (
        <div className="relative flex h-full w-full flex-col">
          <div className="absolute right-1 top-1 z-10 flex gap-1">
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse panel" : "Expand panel"}
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                {expanded ? (
                  <path d="M6 2v12M6 2H3v3M6 14H3v-3M10 2v12M10 2h3v3M10 14h3v-3" strokeLinecap="round" />
                ) : (
                  <path d="M8 2v12M8 2H4v3M8 14H4v-3M8 2h4v3M8 14h4v-3" strokeLinecap="round" />
                )}
              </svg>
            </button>
            <button
              onClick={onClose}
              aria-label="Close panel"
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {/* pt-3 so the first boundary chip (sits 10px above its box) isn't clipped */}
          <div className="scrollbar-none flex h-full min-h-0 flex-col overflow-y-auto pt-3">
            {children}
          </div>
        </div>
      )}
    </div>,
    root
  );
}
