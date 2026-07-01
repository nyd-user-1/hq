"use client";

import { useCommand } from "@/app/ui/command-state";

// A "Quick search" box at the top of the sidebar — a button styled as a search
// input that opens the ⌘K command palette (the real search surface). Mirrors the
// Cloudflare-dashboard quick-search affordance.
export default function QuickSearchItem() {
  const { setOpen } = useCommand();
  return (
    <button
      onClick={() => setOpen(true)}
      className="flex w-full shrink-0 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
    >
      {/* lucide search */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <span className="min-w-0 flex-1 truncate text-left">Quick search…</span>
      <span className="shrink-0 rounded border border-zinc-800 px-1 font-mono text-[10px] text-zinc-600">⌘K</span>
    </button>
  );
}
