"use client";

import { CONSOLE_PANELS, type ConsoleKey } from "@/app/ui/console-state";

// The "‹ ›" pair that rides the Console boundary after the file chip — replaces the
// old single "⌄" switcher. Each is a boundary-flash-chip; clicking steps the active
// Console panel one back / forward (wrapping around the eight), swapping the container
// in place. The dropdown itself now lives on the file chip (console-switch-chip.tsx).
// Mirrors activity-nav-chips.tsx.
const CHIP =
  "boundary-flash-chip flex cursor-pointer items-center bg-zinc-800 px-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:text-zinc-200";

export default function ConsoleNavChips({
  active,
  onSelect,
}: {
  active: ConsoleKey;
  onSelect: (k: ConsoleKey) => void;
}) {
  const n = CONSOLE_PANELS.length;
  const idx = Math.max(0, CONSOLE_PANELS.findIndex((p) => p.key === active));
  const step = (delta: number) =>
    onSelect(CONSOLE_PANELS[(idx + delta + n) % n].key);

  return (
    <div className="flex items-stretch gap-1 self-stretch">
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label="previous console panel"
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
        aria-label="next console panel"
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
