"use client";

import { TOOLS_PANELS, type ToolsKey } from "@/app/ui/tools-state";

// The "‹ ›" pair that rides the Tools boundary after the file chip. Each is a
// boundary-flash-chip; clicking steps the active Tools panel one back / forward
// (wrapping around the four), swapping the container in place. The dropdown itself
// lives on the file chip (tools-switch-chip.tsx). Mirrors console-nav-chips.tsx.
const CHIP =
  "boundary-flash-chip flex cursor-pointer items-center bg-zinc-800 px-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:text-zinc-200";

export default function ToolsNavChips({
  active,
  onSelect,
}: {
  active: ToolsKey;
  onSelect: (k: ToolsKey) => void;
}) {
  const n = TOOLS_PANELS.length;
  const idx = Math.max(0, TOOLS_PANELS.findIndex((p) => p.key === active));
  const step = (delta: number) =>
    onSelect(TOOLS_PANELS[(idx + delta + n) % n].key);

  return (
    <div className="flex items-stretch gap-1 self-stretch">
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label="previous tools panel"
        title="previous panel"
        className={CHIP}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => step(1)}
        aria-label="next tools panel"
        title="next panel"
        className={CHIP}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}
