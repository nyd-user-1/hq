"use client";

import { useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  wallTokens,
  tokenFor,
  parseToken,
  MAX_TERMINALS,
  type PaneContent,
  type WallView,
} from "@/app/ui/terminals";
import SessionMenu from "@/app/ui/session-menu";
import { useFocus } from "@/app/ui/focus-state";

// The boundary-chip Switch/Split menu — a hover "▾" chip on a terminal's boundary.
// SWITCH this terminal's content (a dashboard view or a session) or SPLIT a new
// pane in beside it. Works for any terminal via `target`:
//   { kind: "t1" }            → writes ?session (the anchor; @view = a view in T1)
//   { kind: "wall", index }   → writes the typed ?wall token at that pane's index
// So a terminal is no longer locked to a session; it's a viewport that can hold
// Fleet/Files/Projects OR any session — Terminal 1 included.
type Target = { kind: "t1" } | { kind: "wall"; index: number };

const VIEW_ROWS: { view: WallView; label: string }[] = [
  { view: "fleet", label: "Fleet" },
  { view: "files", label: "Files" },
  { view: "projects", label: "Projects" },
];

const ROW =
  "flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900";

export default function TerminalChipMenu({ target }: { target: Target }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const { setActive } = useFocus();
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

  // This terminal's current content (for the ✓ highlight). null = T1 home/new.
  let current: PaneContent | null = null;
  if (target.kind === "wall") {
    current = parseToken(wallTokens(params)[target.index] ?? "");
  } else {
    const ses = params.get("session");
    current = ses && ses !== "new" ? parseToken(ses) : null;
  }

  const writeWall = (toks: string[]) => {
    const sp = new URLSearchParams(params.toString());
    if (toks.length) sp.set("wall", toks.join(","));
    else sp.delete("wall");
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  };
  const setContent = (c: PaneContent) => {
    if (target.kind === "wall") {
      const toks = wallTokens(params);
      toks[target.index] = tokenFor(c);
      writeWall(toks);
    } else {
      const sp = new URLSearchParams(params.toString());
      sp.set("session", tokenFor(c)); // @view = a view in T1; an id = a session
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    }
    setOpen(false);
  };
  // Split = add a fresh pane beside this one — a "new" sessions-view (the home
  // picker: projects + recent sessions), which loads fast; switch it to a dashboard
  // from its own chip. Focus the new pane so picking a session there opens it there
  // (the picker is focus-aware). Capped at MAX_TERMINALS total (T1 + 3).
  const split = () => {
    const toks = wallTokens(params);
    if (toks.length >= MAX_TERMINALS - 1) return;
    toks.push("new");
    setActive(`t${toks.length + 1}`); // new pane's slot = index + 2
    writeWall(toks);
    setOpen(false);
  };
  const atCap = wallTokens(params).length >= MAX_TERMINALS - 1;

  return (
    <div className="relative flex shrink-0 self-stretch items-stretch" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        type="button"
        aria-label="terminal content menu"
        title="switch this terminal · split"
        className={`boundary-flash-chip flex cursor-pointer items-center bg-zinc-800 px-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:text-zinc-200 ${open ? "text-zinc-100" : ""}`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex w-48 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
          {/* Split FIRST — the Session… row's flyout opens downward, so anything
              below it gets covered; keeping Split at the top keeps it reachable. */}
          <button
            type="button"
            onClick={split}
            disabled={atCap}
            title={atCap ? "max 4 terminals" : "open a new terminal beside this one"}
            className={`${ROW} ${atCap ? "cursor-not-allowed text-zinc-700 hover:bg-transparent" : ""}`}
          >
            <span>Split →</span>
            <span className="text-zinc-600">＋</span>
          </button>
          <div className="my-1 h-px bg-zinc-800" />
          <div className="px-2 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            show in this terminal
          </div>
          {VIEW_ROWS.map(({ view, label }) => {
            const active = current?.kind === "view" && current.view === view;
            return (
              <button
                key={view}
                type="button"
                onClick={() => setContent({ kind: "view", view })}
                className={`${ROW} ${active ? "text-zinc-100" : ""}`}
              >
                <span>{label}</span>
                {active && <span className="text-blue-400">✓</span>}
              </button>
            );
          })}
          {/* Switch this pane to a session — reuses the session picker; pick → this
              terminal shows that session. LAST so its downward flyout covers only
              the content below, not the menu. */}
          <SessionMenu
            currentId={current?.kind === "session" ? current.sessionId : null}
            onPick={(id) => {
              if (id) setContent({ kind: "session", sessionId: id });
              setOpen(false);
            }}
          >
            <span className={`${ROW} ${current?.kind === "session" ? "text-zinc-100" : ""}`}>
              <span>Session…</span>
              <span className="text-zinc-600">›</span>
            </span>
          </SessionMenu>
        </div>
      )}
    </div>
  );
}
