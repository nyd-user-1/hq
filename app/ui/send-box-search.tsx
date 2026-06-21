"use client";

import type { KeyboardEvent, Ref } from "react";
import SearchField from "@/app/ui/search-field";

// The send box's "search this session" mode — the body that REPLACES the
// textarea + toolbar when the box is toggled into search (the solar map-mode
// pattern). Purely presentational: it reuses terminal.tsx's EXISTING in-session
// search engine (the CSS-highlight matcher + match navigation), so there's no
// new search logic here — the caller owns the state and just hands it down.
//
// INTEGRATION (terminal.tsx, once it's free): add a magnifier button to the
// send-box toolbar next to the "+" that flips a `searchMode` flag, and in the
// send-box container render:
//   {searchMode ? (
//     <SendBoxSearch
//       value={searchQuery}
//       onChange={setSearchQuery}
//       inputRef={searchInputRef}
//       matchCount={searchMatchCount}
//       activeIndex={searchActiveIndex}
//       onPrev={() => gotoMatch(-1)}
//       onNext={() => gotoMatch(1)}
//       onClose={closeSearch}      // also flips searchMode off
//     />
//   ) : ( <textarea …/> <toolbar/> )}
// The search reuses the header search's wiring verbatim — same searchQuery,
// same gotoMatch, same highlight — just surfaced in the send box instead.

type Props = {
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  matchCount: number;
  activeIndex: number; // 0-based; displayed as activeIndex + 1
  onPrev: () => void; // previous match (⇧↵)
  onNext: () => void; // next match (↵)
  onClose: () => void; // exit search mode, back to compose (Esc / ✕)
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
    <div className="flex w-full items-center gap-2">
      {/* magnifier — mirrors the box's affordance */}
      <span className="flex shrink-0 items-center text-zinc-500" aria-hidden>
        <svg {...SVG}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>

      {/* the query field — borderless so it blends into the send-box container */}
      <SearchField
        value={value}
        onChange={onChange}
        inputRef={inputRef}
        placeholder="search this session…"
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            (e.shiftKey ? onPrev : onNext)(); // ↵ next · ⇧↵ prev
          }
        }}
        className="hq-find-field !border-0 !bg-transparent !px-1 !py-0.5 !text-xs"
      />

      {/* match count + ↑/↓ nav — only once there's something to count */}
      {hasQuery && (
        <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-zinc-500">
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

      {/* exit search → back to compose */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close search"
        title="back to compose (Esc)"
        className="flex shrink-0 items-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
      >
        <svg {...SVG}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}
