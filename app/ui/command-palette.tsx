"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Boundary from "@/app/ui/boundary";
import { withPins } from "@/app/ui/keep-pins";
import { NAV_TARGETS, type NavTarget } from "@/app/ui/panel-nav";
import { useCommand } from "@/app/ui/command-state";
import { usePlanner } from "@/app/ui/planner-state";
import { useTextEditor } from "@/app/ui/text-editor-state";
import { useSidebar } from "@/app/ui/sidebar-state";

// The ⌘K command palette — a top-anchored launcher over a blurred backdrop.
// Shape borrows the shadcn/cmdk pattern (search row · grouped list with
// separators · icon + label + right-aligned tag · comfortable rows) but is
// hand-built — no cmdk/radix deps (HQ ships three runtime deps total). Wears
// HQ's dashed Boundary frame + file chip to stay consistent with every other
// surface. Two sections: ACTIONS (the client-state tools) and NAVIGATE (every
// panel, pin-carrying via withPins so jumping never resets the terminal). Fully
// keyboard-driven; the mouse mirrors the keyboard selection. State + the global
// hotkey live in command-state.tsx.

type Section = "Actions" | "Navigate";
const SECTION_ORDER: Section[] = ["Actions", "Navigate"];

type Command = {
  id: string;
  section: Section;
  title: string;
  hint?: string; // right-aligned tag (the panel group)
  keywords?: string;
  icon: React.ReactNode;
  run: () => void;
};

const SVG = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconSearch = () => (
  <svg {...SVG}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
const IconText = () => (
  <svg {...SVG}>
    <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
    <path d="M9 20h6" />
    <path d="M12 4v16" />
  </svg>
);
const IconPlanner = () => (
  <svg {...SVG}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);
const IconSidebar = () => (
  <svg {...SVG}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
  </svg>
);
const IconClose = () => (
  <svg {...SVG}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
// per-group nav icons so the list isn't 14 identical glyphs
const IconActivity = () => (
  <svg {...SVG}>
    <path d="M12 2 2 7l10 5 10-5-10-5Z" />
    <path d="m2 17 10 5 10-5" />
    <path d="m2 12 10 5 10-5" />
  </svg>
);
const IconMetrics = () => (
  <svg {...SVG}>
    <line x1="6" x2="6" y1="20" y2="14" />
    <line x1="12" x2="12" y1="20" y2="4" />
    <line x1="18" x2="18" y1="20" y2="10" />
  </svg>
);
const IconConsole = () => (
  <svg {...SVG}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" x2="20" y1="19" y2="19" />
  </svg>
);
const IconCompose = () => (
  <svg {...SVG}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 9h18" />
    <path d="M9 21V9" />
  </svg>
);

function navIcon(t: NavTarget): React.ReactNode {
  if (t.href === "/search") return <IconSearch />;
  if (t.href === "/compose") return <IconCompose />;
  if (t.group === "Activity") return <IconActivity />;
  if (t.group === "Metrics") return <IconMetrics />;
  if (t.group === "Console") return <IconConsole />;
  return <IconCompose />;
}

// substring/token ranking — predictable, no fuzzy surprises. 0 = hidden.
function rank(cmd: Command, q: string): number {
  if (!q) return 1;
  const hay = `${cmd.title} ${cmd.hint ?? ""} ${cmd.keywords ?? ""}`.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.every((t) => hay.includes(t))) return 0;
  const title = cmd.title.toLowerCase();
  if (title === q) return 100;
  if (title.startsWith(q)) return 80;
  if (title.includes(q)) return 60;
  if (title.split(/\s+/).some((w) => w.startsWith(tokens[0]))) return 50;
  return 30; // matched only via keywords / hint
}

export default function CommandPalette() {
  const { open, setOpen } = useCommand();
  const router = useRouter();
  const { toggle: togglePlanner } = usePlanner();
  const { toggle: toggleText } = useTextEditor();
  const { toggle: toggleSidebar } = useSidebar();

  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const go = useCallback(
    (href: string) =>
      router.push(withPins(href, window.location.search), { scroll: false }),
    [router]
  );

  const commands: Command[] = useMemo(
    () => [
      { id: "text", section: "Actions", title: "New text note", keywords: "text editor capture paste write", icon: <IconText />, run: toggleText },
      { id: "planner", section: "Actions", title: "Batch Planner", keywords: "planner batch burn cost sessions", icon: <IconPlanner />, run: togglePlanner },
      { id: "sidebar", section: "Actions", title: "Toggle sidebar", keywords: "sidebar recents hide show", icon: <IconSidebar />, run: toggleSidebar },
      { id: "home", section: "Actions", title: "Close panel", keywords: "close home terminal dismiss", icon: <IconClose />, run: () => go("/") },
      ...NAV_TARGETS.map((t) => ({
        id: `nav:${t.href}`,
        section: "Navigate" as const,
        title: t.title,
        hint: t.group || undefined,
        keywords: t.keywords,
        icon: navIcon(t),
        run: () => go(t.href),
      })),
    ],
    [go, togglePlanner, toggleText, toggleSidebar]
  );

  // Filter + rank, preserve section order, build a flat list for selection.
  const { groups, flat } = useMemo(() => {
    const query = q.trim().toLowerCase();
    const scored = commands
      .map((c) => ({ c, s: rank(c, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s); // stable: equal scores keep registry order
    const flatList: Command[] = [];
    const grouped = SECTION_ORDER.map((section) => ({
      section,
      items: scored.filter((x) => x.c.section === section).map((x) => x.c),
    })).filter((g) => g.items.length > 0);
    grouped.forEach((g) => g.items.forEach((c) => flatList.push(c)));
    return { groups: grouped, flat: flatList };
  }, [commands, q]);

  const selIdx = Math.min(sel, Math.max(0, flat.length - 1));

  // Reset + focus on open.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Keep the selected row in view as it moves.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${selIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selIdx]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const execute = useCallback(
    (cmd?: Command) => {
      if (!cmd) return;
      setOpen(false); // close the launcher first, then act
      cmd.run();
    },
    [setOpen]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Tab") {
      e.preventDefault();
      const dir = e.shiftKey ? flat.length - 1 : 1;
      setSel((s) => (flat.length ? (s + dir) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(flat[selIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      // Light, barely-blurred scrim — the app stays visible behind so the palette
      // reads as a layer ON TOP, not the screen dimming shut.
      style={{ animation: "cmdk-backdrop-in 130ms ease-out" }}
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 px-4 pt-[11vh] backdrop-blur-[2px]"
    >
      <div
        // settles down from slightly above with a soft scale — "mounts on top"
        style={{ animation: "cmdk-pop-in 170ms cubic-bezier(0.16, 1, 0.3, 1)" }}
        className="relative flex max-h-[72vh] w-[720px] max-w-[94vw] flex-col rounded-xl bg-zinc-950 shadow-2xl ring-1 ring-zinc-800/60"
      >
        <Boundary label="command-palette.tsx">
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* search row */}
            <div className="flex items-center gap-3 border-b border-dashed border-zinc-800 pb-3">
              <span className="text-zinc-500">
                <IconSearch />
              </span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSel(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Type a command, or search panels…"
                spellCheck={false}
                className="w-full bg-transparent font-mono text-[14px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              />
              <kbd className="shrink-0 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                esc
              </kbd>
            </div>

            {/* results */}
            <div
              ref={listRef}
              className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-2"
            >
              {flat.length === 0 ? (
                <p className="px-1 py-10 text-center font-mono text-[12px] text-zinc-600">
                  No matching commands
                </p>
              ) : (
                groups.map((g, gi) => (
                  <Fragment key={g.section}>
                    {gi > 0 && (
                      <div className="mx-1 border-t border-dashed border-zinc-800/80" />
                    )}
                    <div className="flex flex-col gap-0.5">
                      <div className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                        {g.section}
                      </div>
                      {g.items.map((cmd) => {
                        const idx = flat.indexOf(cmd);
                        const isSel = idx === selIdx;
                        return (
                          <button
                            key={cmd.id}
                            data-idx={idx}
                            onMouseMove={() => setSel(idx)}
                            onClick={() => execute(cmd)}
                            className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                              isSel
                                ? "bg-zinc-800 text-zinc-100"
                                : "text-zinc-300 hover:bg-zinc-900"
                            }`}
                          >
                            <span
                              className={
                                isSel ? "text-orange-400" : "text-zinc-500"
                              }
                            >
                              {cmd.icon}
                            </span>
                            <span className="flex-1 truncate font-mono text-[13px]">
                              {cmd.title}
                            </span>
                            {cmd.hint && (
                              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
                                {cmd.hint}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </Fragment>
                ))
              )}
            </div>

            {/* footer */}
            <div className="flex items-center justify-between border-t border-dashed border-zinc-800 pt-2.5 font-mono text-[10px] text-zinc-600">
              <span>
                {flat.length} command{flat.length === 1 ? "" : "s"}
              </span>
              <span>↑↓ navigate · ↵ open · esc close</span>
            </div>
          </div>
        </Boundary>
      </div>
    </div>,
    document.body
  );
}
