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
        <div className="flex h-full w-full flex-col">
          {/* slim header row — keeps the controls clear of the boundary chip */}
          <div className="flex shrink-0 justify-end gap-1 pb-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse to a third" : "Expand to half"}
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              {/* columns icon shows the TARGET layout: Columns2 (→ half) when
                  collapsed, Columns3 (→ third) when expanded */}
              <svg
                width="15"
                height="15"
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
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg
                width="15"
                height="15"
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
          {/* pt-3 so the first boundary chip (sits 10px above its box) isn't clipped */}
          <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto pt-3">
            {children}
          </div>
        </div>
      )}
    </div>,
    root
  );
}
