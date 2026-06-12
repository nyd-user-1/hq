"use client";

import { useState } from "react";

// The file-path chip, clickable: one click copies the path verbatim — handy
// for pasting straight into a Claude prompt or an editor's open-file box.
export default function BoundaryChip({ label }: { label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(label);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title="click to copy path"
      className="boundary-flash-chip min-w-0 cursor-pointer truncate bg-zinc-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400 transition-colors hover:text-zinc-200"
    >
      {copied ? "copied ✓" : label}
    </button>
  );
}
