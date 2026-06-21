"use client";

import type { KeyboardEvent, Ref } from "react";

// "Search this session" mode for the send box — the solar map/voice-mode pattern.
// The box KEEPS its exact shape: a plain text line on top, a toolbar row beneath,
// just like compose. The ONLY mode signals are (1) the send-box CONTAINER border
// turning yellow (set in terminal.tsx, matching the #facc15 in-transcript
// highlights) and (2) the placeholder flipping to "search this session…". The
// input itself is BARE — no border, no background, no box — styled identically to
// the compose textarea, so to the user it looks like they're just typing on the
// normal send-box line.
//
// Returns a FRAGMENT (input + toolbar) so the two rows slot directly into the
// send-box container's `flex flex-col gap-2`, exactly where the textarea+toolbar
// sit in compose. Purely presentational — reuses terminal.tsx's existing
// in-transcript highlighter + match navigation (props map to searchQuery /
// setSearchQuery / sendSearchInputRef / searchMatchCount / searchActiveIndex /
// gotoMatch / closeSendSearch). The active (yellow) magnifier doubles as exit.

type Props = {
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  matchCount: number;
  activeIndex: number; // 0-based; shown as activeIndex + 1
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void; // exit search → compose (the active magnifier / Esc)
};

const SVG = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const navBtn =
  "flex items-center rounded p-0.5 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent";

export default function SendBoxSearch({
  value,
  onChange,
  inputRef,
  matchCount,
  activeIndex,
  onPrev,
  onNext,
  onClose,
}: Props) {
  const hasQuery = value.trim().length > 0;
  return (
    <>
      {/* Row 1 — the INVISIBLE search input. Same classes as the compose textarea
          (transparent, no border/bg), so it reads as the normal send-box line. */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            (e.shiftKey ? onPrev : onNext)(); // ↵ next · ⇧↵ prev
          }
        }}
        placeholder="search this session…"
        autoComplete="off"
        spellCheck={false}
        className="min-h-[40px] w-full bg-transparent px-1 py-0.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
      />

      {/* Row 2 — the toolbar (same shape as compose): the ACTIVE yellow magnifier
          doubles as exit, with match count + ↑/↓ on the right. */}
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Exit search"
          title="exit search (Esc)"
          className="flex shrink-0 items-center rounded-md border border-zinc-700 p-1.5 text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white"
        >
          {/* in search mode the magnifier becomes the traditional ✕ — the exit */}
          <svg {...SVG}>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        {hasQuery && (
          <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[10px] text-zinc-500">
            <button
              type="button"
              onClick={onPrev}
              disabled={!matchCount}
              aria-label="Previous match"
              title="previous match (⇧↵)"
              className={navBtn}
            >
              <svg {...SVG} width={13} height={13}>
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!matchCount}
              aria-label="Next match"
              title="next match (↵)"
              className={navBtn}
            >
              <svg {...SVG} width={13} height={13}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <span className="tabular-nums" title="↵ next · ⇧↵ previous">
              {matchCount ? activeIndex + 1 : 0}/{matchCount}
            </span>
          </span>
        )}
      </div>
    </>
  );
}
