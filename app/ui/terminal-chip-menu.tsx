"use client";

import { useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { wallTokens, MAX_TERMINALS } from "@/app/ui/terminals";
import { useFocus } from "@/app/ui/focus-state";
import { useTeams } from "@/app/ui/teams-state";

// The boundary-chip "▾" menu on a terminal. Two actions:
//   • Split       — open a fresh pane beside this one (a "new" home picker).
//   • Agent Teams — open the Teams panel (the single entry to the team surface);
//                   pick a card there to fill the wall with a team.
// Fleet/Files/Projects and session-switching moved OUT: those now come from the
// sidebar and render in a terminal (the tab model), so this menu stays lean.

// lucide "columns-2" — the Split glyph (a pane beside a pane).
function Columns2Icon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M12 3v18" />
    </svg>
  );
}
// lucide "network" — the Agent Teams glyph (a hub over three nodes), matching the
// sidebar Agent Teams item.
function NetworkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </svg>
  );
}

export default function TerminalChipMenu() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const { setActive } = useFocus();
  const { setOpen: setTeamsOpen } = useTeams();
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

  // Split = add a fresh pane beside this one — a "new" home picker (loads fast).
  // Focus the new pane so picking a session there opens it there. Capped at
  // MAX_TERMINALS total (T1 + 3).
  const split = () => {
    const toks = wallTokens(params);
    if (toks.length >= MAX_TERMINALS - 1) return;
    toks.push("new");
    setActive(`t${toks.length + 1}`); // the new pane's slot = index + 2
    const sp = new URLSearchParams(params.toString());
    sp.set("wall", toks.join(","));
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    setOpen(false);
  };
  const atCap = wallTokens(params).length >= MAX_TERMINALS - 1;

  const openTeams = () => {
    setTeamsOpen(true);
    setOpen(false);
  };

  const ROW =
    "flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900";

  return (
    <div className="relative flex shrink-0 self-stretch items-stretch" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        type="button"
        aria-label="terminal menu"
        title="split · team"
        className={`boundary-flash-chip flex cursor-pointer items-center bg-zinc-800 px-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:text-zinc-200 ${open ? "text-zinc-100" : ""}`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex w-44 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
          <button
            type="button"
            onClick={split}
            disabled={atCap}
            title={atCap ? "max 4 terminals" : "open a new terminal beside this one"}
            className={`${ROW} ${atCap ? "cursor-not-allowed text-zinc-700 hover:bg-transparent" : ""}`}
          >
            <span className="flex items-center gap-2.5">
              <Columns2Icon />
              Split
            </span>
            <span className="text-zinc-600">＋</span>
          </button>
          <button type="button" onClick={openTeams} className={ROW}>
            <span className="flex items-center gap-2.5">
              <NetworkIcon />
              Agent Teams
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
