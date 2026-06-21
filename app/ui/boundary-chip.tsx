"use client";

import { useState } from "react";

// Shared chip shell — the boundary-line chip look. BoundaryChip (click-to-copy a
// path), PanelMenu (the ▾ menu variant) and SearchTrigger (the 🔍 variant) all
// wear this so every chip sitting on a boundary line is visually identical.
export const CHIP_CLASS =
  "boundary-flash-chip cursor-pointer bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:text-zinc-200";

// The file chip, clickable: one click copies a path verbatim — paste it straight
// into a Claude prompt or an editor's open-file box. `label` is what SHOWS (a
// filename or, for a component, its name, true-cased — no UPPERCASE transform);
// `copyText` is what's COPIED (the full repo-relative path) when it must differ
// from the display, so a chip can read `Terminal` yet copy `app/ui/terminal.tsx`.
export default function BoundaryChip({
  label,
  copyText,
  className = "",
}: {
  label: string;
  copyText?: string;
  // Optional extra classes — lets a caller tint the chip (e.g. yellow while the
  // send box is in search mode). Appended last so `!` overrides win.
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  // Display the file name WITHOUT its extension (terminal.tsx → terminal); the
  // click-to-copy still copies the FULL path (extension kept) so it drops cleanly
  // into a terminal.
  const shown = label.replace(/\.tsx?$/, "");
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(copyText ?? label);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={copyText ? `click to copy ${copyText}` : "click to copy path"}
      className={`${CHIP_CLASS} min-w-0 truncate ${className}`}
    >
      {copied ? "copied ✓" : shown}
    </button>
  );
}
