"use client";

import { useEffect, useState } from "react";
import type { MetricItem } from "@/lib/fleet";
import DashboardBoard, { type GlobalRange, GLOBAL_RANGES } from "./dashboard-board";

// The landing's analytics dashboard — the REAL Analytics board, fetched from the
// same /api/fleet/metrics the live view polls, rendered by the real ShapeCard
// components. Client-fetched because the landing mounts inside the client
// Terminal1Slot. This pane also owns the frame's header row: the blinking "live"
// dot and the calendar filter (the old static "live" label) that reshapes every
// card on the board.
const IDS = [
  "f_sessions",
  "f_tokens",
  "f_turns",
  "f_projects",
  "todos_pending",
  "f_cliff",
  "tokens_by_session_area",
  "tokens_day_area",
  "tokens_stacked_area",
].join(",");

// A green "live" dot with an expanding ping halo — the dashboard is reading.
function LiveDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-green-500" />
    </span>
  );
}

// The calendar range filter (replaces the static "live" text). Picking a range
// reshapes all charts + stats on the board.
function LiveMenu({ value, onChange }: { value: GlobalRange; onChange: (v: GlobalRange) => void }) {
  const [open, setOpen] = useState(false);
  const cur = GLOBAL_RANGES.find(([k]) => k === value)?.[1] ?? "Live";
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        {value === "live" && <LiveDot />}
        <span>{cur}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <span className="absolute right-0 top-7 z-20 flex w-36 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
            {GLOBAL_RANGES.map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  onChange(k);
                  setOpen(false);
                }}
                className={`rounded px-2 py-1 text-left text-[11px] transition-colors hover:bg-zinc-900 ${k === value ? "text-green-400" : "text-zinc-300"}`}
              >
                {l}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

export default function DashboardShot() {
  const [items, setItems] = useState<MetricItem[] | null>(null);
  const [range, setRange] = useState<GlobalRange>("live");

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/fleet/metrics?ids=${IDS}`)
        .then((r) => r.json())
        .then((d) => {
          if (alive && Array.isArray(d?.items)) setItems(d.items);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b px-4 py-2.5 font-mono text-[11px]" style={{ borderColor: "#ffffff0d" }}>
        <LiveDot />
        <span style={{ color: "#d0d6e0" }}>hq</span>
        <span style={{ color: "#62666d" }}>·</span>
        <span style={{ color: "#8a8f98" }}>analytics</span>
        <span className="ml-auto">
          <LiveMenu value={range} onChange={setRange} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {items ? <DashboardBoard items={items} range={range} /> : <div aria-hidden className="h-full" />}
      </div>
    </div>
  );
}
