"use client";

import { useRef, useState } from "react";
import { ACTIVITY_PANELS, type ActivityKey } from "@/app/ui/activity-state";

// The "⌄" switcher that rides the Activity boundary, right after the file-path chip —
// same slot and look as the Console one (boundary-flash-chip). Opens a dropdown of the
// Activity panels; picking one swaps the container in place (activity-panel re-keys its
// Boundary, so the flash replays and the chip label changes). A replace, not a push.
export default function ActivitySwitchChip({
  active,
  onSelect,
}: {
  active: ActivityKey;
  onSelect: (k: ActivityKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  const ROW =
    "flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-900";

  return (
    <div
      className="relative flex shrink-0 items-stretch self-stretch"
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <button
        type="button"
        aria-label="switch activity panel"
        title="switch panel"
        className={`boundary-flash-chip flex cursor-pointer items-center bg-zinc-800 px-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:text-zinc-200 ${
          open ? "text-zinc-100" : ""
        }`}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex w-44 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
          {ACTIVITY_PANELS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                onSelect(p.key);
                setOpen(false);
              }}
              className={`${ROW} ${p.key === active ? "text-zinc-100" : "text-zinc-300"}`}
            >
              <span>{p.title}</span>
              {p.key === active && <span className="text-[8px] text-blue-400">●</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
