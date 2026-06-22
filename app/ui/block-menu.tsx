"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The per-message-block actions menu — one kebab (⋮, the sidebar-row pattern)
// replacing the old standalone copy + save-note icons. Opens a dark dropdown:
// Copy · Favorite (a ★ cue) · Save as note · Save as code · 👍 / 👎 · Hide.
// Purely presentational: every action is a callback the terminal wires to the
// block-meta sidecar / notes API. Portaled + fixed-positioned off the kebab so it
// floats over the transcript without the scroll container clipping it.

type Reaction = "up" | "down";

const SVG = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const Kebab = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="19" r="1.6" />
  </svg>
);

// A single menu row. `active` tints it (favorited / current reaction). Hoisted
// out of BlockMenu so it isn't re-created during render.
function MenuItem({
  icon,
  label,
  onClick,
  active,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-900 ${
        active ? "text-yellow-300" : "text-zinc-300"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </button>
  );
}

export default function BlockMenu({
  saved,
  favorite,
  hidden,
  reaction,
  showReactions = true,
  onCopy,
  onFavorite,
  onSaveNote,
  onSaveCode,
  onReact,
  onHide,
}: {
  saved: boolean;
  favorite: boolean;
  hidden: boolean;
  reaction: Reaction | null;
  showReactions?: boolean; // 👍/👎 only make sense on Claude's replies
  onCopy: () => void;
  onFavorite: () => void;
  onSaveNote: () => void;
  onSaveCode: () => void;
  onReact: (r: Reaction) => void;
  onHide: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on any outside click, Escape, or scroll — matches the sidebar kebab.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  };

  // Run an action, then close the menu.
  const choose = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="Block actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`absolute right-2 top-2 rounded-md border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-500 transition hover:text-zinc-200 focus:opacity-100 ${
          open || favorite || saved || reaction
            ? "opacity-100"
            : "opacity-0 group-hover/turn:opacity-100"
        }`}
      >
        <Kebab />
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-50 flex w-44 flex-col whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
          >
            <MenuItem
              icon={
                <svg {...SVG}>
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              }
              label="Copy"
              onClick={choose(onCopy)}
            />
            <MenuItem
              icon={
                <svg {...SVG} fill={favorite ? "currentColor" : "none"}>
                  <path d="M12 2l2.9 6.3 6.8.8-5 4.6 1.3 6.7L12 17.8 5.7 21l1.3-6.7-5-4.6 6.8-.8z" />
                </svg>
              }
              label={favorite ? "Unfavorite" : "Favorite"}
              onClick={choose(onFavorite)}
              active={favorite}
            />
            <MenuItem
              icon={
                <svg {...SVG}>
                  <path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M15 3v5h5" />
                  <path d="M8 13h6M8 17h4" />
                </svg>
              }
              label={saved ? "Saved as note" : "Save as note"}
              onClick={choose(onSaveNote)}
              active={saved}
            />
            <MenuItem
              icon={
                <svg {...SVG}>
                  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
                  <path d="m10 13-2 2 2 2" />
                  <path d="m14 13 2 2-2 2" />
                </svg>
              }
              label="Save as code"
              onClick={choose(onSaveCode)}
            />
            {showReactions && (
              <>
                <div className="my-1 h-px bg-zinc-800" />
                <MenuItem
                  icon={
                    <svg {...SVG} fill={reaction === "up" ? "currentColor" : "none"}>
                      <path d="M7 10v12" />
                      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
                    </svg>
                  }
                  label="Good response"
                  onClick={choose(() => onReact("up"))}
                  active={reaction === "up"}
                />
                <MenuItem
                  icon={
                    <svg {...SVG} fill={reaction === "down" ? "currentColor" : "none"}>
                      <path d="M17 14V2" />
                      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
                    </svg>
                  }
                  label="Bad response"
                  onClick={choose(() => onReact("down"))}
                  active={reaction === "down"}
                />
              </>
            )}
            <div className="my-1 h-px bg-zinc-800" />
            <MenuItem
              icon={
                <svg {...SVG}>
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                  <path d="m2 2 20 20" />
                </svg>
              }
              label={hidden ? "Unhide" : "Hide"}
              onClick={choose(onHide)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
