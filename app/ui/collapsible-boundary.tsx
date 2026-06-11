"use client";

import { useState } from "react";

// Boundary variant whose chip is the accordion toggle: `head` stays visible,
// children collapse. Keep the box/chip classes in sync with boundary.tsx.
export default function CollapsibleBoundary({
  label,
  head,
  children,
}: {
  label: string;
  head: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="boundary-flash relative flex min-h-0 min-w-0 flex-1 flex-col gap-4 rounded-lg border border-dashed border-zinc-700 p-4 pt-7 sm:p-5 sm:pt-7">
      <button
        onClick={() => setOpen(!open)}
        className="boundary-flash-chip absolute -top-2.5 left-4 flex max-w-[calc(100%-2rem)] cursor-pointer items-center bg-zinc-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400"
      >
        <span className="truncate">{label}</span>
        <span className="ml-2 text-sm leading-none">{open ? "▴" : "▾"}</span>
      </button>
      {head}
      {open && children}
    </div>
  );
}
