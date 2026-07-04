"use client";

import { useRef, useState } from "react";
import BoundaryChip from "@/app/ui/boundary-chip";

// The ONE panel-group switcher — the file-path chip that reveals a group's member
// list on hover. A row's TEXT swaps the container in place (onSelect); the trailing
// "↗" pops that member out as its own standalone panel (onPopOut). Generic over the
// group: the container passes its members + the two callbacks. `extraRows` are
// navigate-only rows (e.g. Activity's Search → /search); `sortAZ` sorts the menu.
// Replaced the per-group activity/console/tools switch-chips.
type Member = { key: string; title: string };
export type ExtraRow = { key: string; title: string; onOpen: () => void };

function ArrowUpRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

export default function GroupSwitchChip({
  file,
  active,
  members,
  onSelect,
  onPopOut,
  extraRows = [],
  sortAZ = false,
}: {
  file: string;
  active: string;
  members: Member[];
  onSelect: (k: string) => void;
  onPopOut: (k: string) => void;
  extraRows?: ExtraRow[];
  sortAZ?: boolean;
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

  type Row = { key: string; title: string; onOpen?: () => void };
  let rows: Row[] = [...members.map((m) => ({ key: m.key, title: m.title })), ...extraRows];
  if (sortAZ) rows = [...rows].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div
      className="relative flex shrink-0 items-stretch self-stretch"
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {/* the boundary file chip — click still copies the path (BoundaryChip default) */}
      <BoundaryChip label={file} />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex w-52 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center rounded transition-colors hover:bg-zinc-900"
            >
              <button
                type="button"
                onClick={() => {
                  if (row.onOpen) row.onOpen();
                  else onSelect(row.key);
                  setOpen(false);
                }}
                className={`flex flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-xs ${row.key === active ? "text-zinc-100" : "text-zinc-300"}`}
              >
                <span>{row.title}</span>
                {row.key === active && <span className="text-[8px] text-blue-400">●</span>}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (row.onOpen) row.onOpen();
                  else onPopOut(row.key);
                  setOpen(false);
                }}
                aria-label={`open ${row.title} in a separate panel`}
                title="open in a separate panel"
                className="mr-1 rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <ArrowUpRight />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
