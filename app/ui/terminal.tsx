"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import Markdown from "@/app/ui/md";
import BlockMenu from "@/app/ui/block-menu";
import BoundaryChip from "@/app/ui/boundary-chip";
import SearchField from "@/app/ui/search-field";
import TodoMenu from "@/app/ui/todo-menu";
import ButtonChipIcon from "@/app/ui/button-chip-icon";
import SendBoxSearch from "@/app/ui/send-box-search";
import Tooltip from "@/app/ui/tooltip";
import PanelMenu from "@/app/ui/panel-menu";
import { useRepl } from "@/app/ui/use-repl";
import { OnboardingConversation } from "@/app/ui/landing-install";
import { CONTEXT_LIMIT, PRICING_CLIFF } from "@/lib/limits";
import type { TimelineItem } from "@/lib/transcript";
import type { BlockMeta, Reaction } from "@/lib/block-meta";

// Minimal typing for the CSS Custom Highlight API (not yet in the TS DOM lib).
// In-session find-in-page registers Ranges here to overlay highlights WITHOUT
// rewriting the Markdown-rendered DOM.
type HighlightCtor = new (...ranges: Range[]) => { priority: number };
type HighlightRegistry = Map<string, { priority: number }>;
function highlightApi(): { reg: HighlightRegistry; Ctor: HighlightCtor } | null {
  const reg = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const Ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  return reg && Ctor ? { reg, Ctor } : null;
}

// CSS injected at runtime because Turbopack's DEV CSS pipeline mangles it (the
// production Lightning CSS build is fine): it rejects the `::highlight()`
// pseudo-element outright AND silently drops the `.is-thinking .boundary-flash-chip`
// descendant rules. A <style> tag the browser parses natively is the portable
// home for all of it. (@property --hq-spin + @keyframes hq-border-spin stay in
// globals.css — the pulse below references them across the same document.)
const TERMINAL_RUNTIME_CSS = `
/* Turn-state border: orange while awaiting a complete response, green when done,
   red when the user hard-interrupted (stays until the next input). !important so
   the state beats the 1.2s boundary-flash LOAD animation — without it, refreshing
   mid-turn shows blue→grey→state (the animation outranks normal rules until it
   ends); with it the state wins immediately (blue flash → state, no grey gap). */
.boundary-flash.is-thinking { border-color: #f97316 !important; }
.boundary-flash.is-done { border-color: #22c55e !important; }
.boundary-flash.is-interrupted { border-color: #ef4444 !important; }
/* Traveling pulse — shared shell, color per state. */
.boundary-flash.is-thinking::after,
.boundary-flash.is-done::after,
.boundary-flash.is-interrupted::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  animation: hq-border-spin 2.2s linear infinite; pointer-events: none;
}
.boundary-flash.is-thinking::after {
  background: conic-gradient(from var(--hq-spin), transparent 0deg, #fbbf24 35deg, #fb923c 55deg, transparent 95deg, transparent 360deg);
}
.boundary-flash.is-done::after {
  background: conic-gradient(from var(--hq-spin), transparent 0deg, #86efac 35deg, #22c55e 55deg, transparent 95deg, transparent 360deg);
}
.boundary-flash.is-interrupted::after {
  background: conic-gradient(from var(--hq-spin), transparent 0deg, #fca5a5 35deg, #ef4444 55deg, transparent 95deg, transparent 360deg);
}
/* Boundary chips ride the state — copying the rerender-flash pattern (which uses
   a blue-600 chip bg + white text): the chip BACKGROUND takes the state color in a
   600 shade for crisp white text, while the border stays the vivid 500. Orange
   thinking, green done, red interrupted. */
.boundary-flash.is-thinking .boundary-flash-chip { background-color: #ea580c !important; color: #fff !important; }
.boundary-flash.is-done .boundary-flash-chip { background-color: #16a34a !important; color: #fff !important; }
.boundary-flash.is-interrupted .boundary-flash-chip { background-color: #dc2626 !important; color: #fff !important; }
/* Find-in-page: a crisp white × on a dark circle for the native clear button. */
.hq-find-field::-webkit-search-cancel-button {
  -webkit-appearance: none; appearance: none;
  height: 14px; width: 14px; margin-left: 4px; cursor: pointer;
  background: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='8' fill='%233f3f46'/><path d='M5.5 5.5 10.5 10.5 M10.5 5.5 5.5 10.5' fill='none' stroke='%23ffffff' stroke-width='1.6' stroke-linecap='round'/></svg>") center / contain no-repeat;
}
/* Find-in-page highlights (CSS Custom Highlight API). */
::highlight(hq-search-session),
::highlight(hq-search-pair) { background-color: rgba(250, 204, 21, 0.45); color: #fef9c3; }
::highlight(hq-search-active-session),
::highlight(hq-search-active-pair) { background-color: #facc15; color: #18181b; }
/* Search: any tool-step accordion CONTAINING a match takes the send box's yellow
   search border (border-yellow-300/70) — color only, 1px stays — so the user sees
   which collapsed section holds the keyword. */
details[data-hq-match] { border-color: rgba(253, 224, 71, 0.7) !important; }`;
function ensureTerminalRuntimeStyle() {
  if (typeof document === "undefined") return;
  const ID = "hq-terminal-runtime-style";
  // Find-or-create + always sync the content. NOT an id-guarded early return:
  // that left a stale <style> in the tab across HMR edits (the source/bundle
  // updated, the injected CSS didn't), which masked fixes during dev iteration.
  let style = document.getElementById(ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== TERMINAL_RUNTIME_CSS)
    style.textContent = TERMINAL_RUNTIME_CSS;
}

// The persistent heart. Mounted once in the shell (root layout) so it NEVER
// remounts as the sidebar navigates the panel — it only re-renders when
// ?session changes, swapping which session it shows/drives. Client island:
// never imports a node:fs lib runtime value; it fetches via /api/terminal/* and
// uses `import type` only.
type Status = {
  startedAt: number;
  outputTokens: number;
  phase: string;
  phases: string[];
} | null;

// Resume options the API attaches on a fresh (post-/clear) session. Every
// affordance here either observes (pin) or copies — never spends (001.8).
type ResumeOptions = {
  handoff: { name: string; path: string; mtime: number } | null;
  sessions: {
    id: string;
    project: string;
    lastActive: number;
    snippet: string;
    contextTokens: number;
  }[];
} | null;

// The session's place in its /clear chain (lib/lineage.ts): predecessor =
// the session this one continues, successor = the one that continues it,
// chain = the whole tied line, oldest → newest.
type LineageNode = {
  id: string;
  project: string;
  title: string;
  bornAt: number;
  lastActive: number;
};
type Lineage = {
  chain: LineageNode[] | null;
  predecessor: LineageNode | null;
  successor: LineageNode | null;
} | null;

// Spinner mood words, cycled by elapsed — the live "it's alive" flavor the real
// CLI shows ("Sprouting…", "Marinating…").
const MOODS = [
  "Sprouting", "Marinating", "Percolating", "Simmering", "Noodling",
  "Brewing", "Cooking", "Pondering", "Churning", "Conjuring", "Tinkering",
];
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}
function fmtElapsed(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
// Raw transcript model id → friendly send-box label. The transcript records ids
// like "claude-opus-4-8" / "claude-sonnet-4-6" / "claude-haiku-4-5-20251001"
// (the [1m] tier is a CLI launch flag, not in the data). Falls back to a cleaned id.
function modelLabel(id: string): string {
  if (!id) return "";
  const m = id.toLowerCase();
  const fam = m.includes("opus")
    ? "Opus"
    : m.includes("sonnet")
      ? "Sonnet"
      : m.includes("haiku")
        ? "Haiku"
        : m.includes("fable")
          ? "Fable"
          : "";
  const two = m.match(/(\d+)[-.](\d+)/); // 4-8 → 4.8
  const one = m.match(/(?:fable|opus|sonnet|haiku)-(\d+)\b/); // fable-5 → 5
  if (fam && two) return `${fam} ${two[1]}.${two[2]}`;
  if (fam && one) return `${fam} ${one[1]}`;
  if (fam) return fam;
  return id.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-/g, " ");
}
// Models offered by the send-box picker. The chosen id rides along on the send
// as `claude --model <id>`, which sets the resumed session's model. Add more here.
const MODELS: { id: string; desc: string }[] = [
  { id: "claude-opus-4-8", desc: "most capable" },
  { id: "claude-sonnet-4-6", desc: "balanced — fast everyday" },
  { id: "claude-haiku-4-5-20251001", desc: "fastest, cheapest" },
];
function fmtAgo(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m % 60;
    return rem ? `${h}h ${rem}m ago` : `${h}h ago`; // drop the "0m" on the hour
  }
  return `${Math.floor(h / 24)}d ago`;
}

// The Anthropic prompt cache holds ~5 minutes; reply inside the window and the
// whole history is read at ~10% price. The header counts the window down.
const CACHE_TTL_MS = 5 * 60 * 1000;
// CONTEXT_LIMIT (1M window) + PRICING_CLIFF (200k cliff marker) live in
// lib/limits — imported above so the client bundle never pulls in node:fs.

// A pasted/dropped screenshot, compressed in the browser BEFORE it leaves the
// page. Capping the long edge + re-encoding as JPEG keeps the POST small, the
// temp file small, and the vision token cost near its floor — an image is
// re-sent on every turn until compaction, so squeezing it here is token
// efficiency (objective #4), not just bandwidth.
type Attachment = {
  id: string;
  name: string;
  mime: string; // always image/jpeg after compression
  data: string; // base64, no data-url prefix
  w: number;
  h: number;
  bytes: number; // approx decoded size, for the chip label
};

const ATTACH_MAX_EDGE = 1568; // Anthropic's vision sweet spot — bigger buys nothing
const ATTACH_QUALITY = 0.85;
const ATTACH_LIMIT = 8;

async function compressImage(file: Blob, name: string): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    ATTACH_MAX_EDGE / Math.max(bitmap.width, bitmap.height)
  );
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas context");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", ATTACH_QUALITY);
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return {
    id: crypto.randomUUID(),
    name: name || "screenshot.jpg",
    mime: "image/jpeg",
    data,
    w,
    h,
    bytes: Math.round(data.length * 0.75),
  };
}

// True only for an OS file drag (not an internal/text drag). Lets a pane claim
// screenshots while leaving any future internal drag-and-drop untouched.
function isFileDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes("Files");
}

// A To Do card dragged in from the panel (the marker is set in todo-list.tsx —
// keep the string in sync). Distinct from a file drag so dropping one fills the
// message box (use it as a prompt) instead of attaching a file.
const TODO_DND_TYPE = "application/x-hq-todo";
function isTodoDrag(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes(TODO_DND_TYPE);
}
function dragKind(dt: DataTransfer | null): "file" | "todo" | null {
  if (isFileDrag(dt)) return "file";
  if (isTodoDrag(dt)) return "todo";
  return null;
}

// Labeled click-to-copy chip — the "deliberately copy, not send" affordance
// (wrap-up strip precedent): the action happens in YOUR terminal, not HQ's.
function CopyChip({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 rounded-md border border-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200"
    >
      {copied ? "copied ✓" : label}
    </button>
  );
}

// Recent-session DATA TABLE, shared by the fresh pane and the "+" staging view.
// A SearchField + a "Filter" (by project) dropdown — the shipped-feed/components
// control pair — sit on a header rule; below, each session is a distinct
// clickable row in one bordered box: session id (the session's NAME —
// first-class) · project · description · ctx · timestamp · a ⋯ actions menu (the
// sidebar Recents kebab, brought here: Open / Terminal 2 / Star / Hide / Copy id;
// Star + Hide persist to the same ~/.claude/hq sidecar).
function RecentSessions({
  sessions,
  now,
}: {
  sessions: NonNullable<ResumeOptions>["sessions"];
  now: number;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const pairParam = params.get("pair");
  const sessionParam = params.get("session");

  const [filter, setFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null); // row whose ⋯ menu is open
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set()); // optimistic hide
  const [starred, setStarred] = useState<Set<string>>(new Set()); // optimistic star
  const [copied, setCopied] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Close the ⋯ menu on any outside click, Escape, or scroll (the menu stops its
  // own propagation; items close it explicitly). Mirrors sidebar-recents.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => {
      setMenuFor(null);
      setMenuPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuFor]);

  // Close the "Filter" dropdown on an outside click (shipped-feed pattern).
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node))
        setFilterOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [filterOpen]);

  // Fire-and-forget write to the shared sidecar (~/.claude/hq/sessions-meta.json),
  // the SAME store the sidebar Recents menu writes — favorite/hide stay in sync.
  const postMeta = (id: string, body: Record<string, unknown>) => {
    fetch("/api/sessions-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    }).catch(() => {});
  };

  const openMenu = (e: ReactMouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCopied(false);
    if (menuFor === id) {
      setMenuFor(null);
      setMenuPos(null);
      return;
    }
    // Anchor to the ⋯ BUTTON (left-aligned, just below it). The Action column is
    // the first column now, so a row-right anchor would float the menu far away.
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const w = 220;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setMenuPos({ top: r.bottom + 4, left, width: w });
    setMenuFor(id);
  };
  const closeMenu = () => {
    setMenuFor(null);
    setMenuPos(null);
  };

  if (sessions.length === 0) return null;

  const openHref = (id: string) =>
    pairParam ? `${pathname}?session=${id}&pair=${pairParam}` : `${pathname}?session=${id}`;

  const q = filter.trim().toLowerCase();
  const projectNames = [...new Set(sessions.map((s) => s.project))].sort();
  const rows = sessions
    .filter((s) => !hidden.has(s.id))
    .filter((s) => !projectFilter || s.project === projectFilter)
    .filter((s) => !q || `${s.id} ${s.project} ${s.snippet ?? ""}`.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => b.lastActive - a.lastActive);
  const menuSession = menuFor ? sessions.find((s) => s.id === menuFor) : null;
  const menuItem =
    "flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900";

  return (
    <div className="flex flex-col gap-3">
      {/* header — SearchField (left, narrowed) IN LINE with the "Filter" (by
          project) dropdown on the right; the Shipped feed / Components control pair. */}
      <div className="flex items-end gap-2 border-b border-zinc-800/60 pb-2">
        <div className="w-72 max-w-[60%] shrink-0">
          <SearchField
            value={filter}
            onChange={setFilter}
            placeholder="Search sessions…"
            className="h-[35px] py-0"
          />
        </div>
        <div ref={filterRef} className="relative ml-auto">
          <button
            onClick={() => setFilterOpen((o) => !o)}
            title="filter by project"
            aria-label="Filter by project"
            aria-haspopup="menu"
            aria-expanded={filterOpen}
            className="flex max-w-full items-center rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <span className="truncate">{projectFilter ?? "Filter"}</span>
          </button>
          {filterOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1 flex max-h-72 w-48 flex-col overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
            >
              <button
                role="menuitem"
                onClick={() => {
                  setProjectFilter(null);
                  setFilterOpen(false);
                }}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
              >
                <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                  All
                </span>
                {projectFilter === null && <span className="ml-auto text-xs text-blue-400">✓</span>}
              </button>
              {projectNames.map((p) => (
                <button
                  key={p}
                  role="menuitem"
                  onClick={() => {
                    setProjectFilter((prev) => (prev === p ? null : p));
                    setFilterOpen(false);
                  }}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
                >
                  <span className="min-w-0 truncate font-mono text-[11px] text-zinc-300">{p}</span>
                  {projectFilter === p && <span className="ml-auto text-xs text-blue-400">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* the table */}
      <div className="scrollbar-none max-h-80 overflow-y-auto rounded-lg border border-zinc-800">
        {/* fixed (sticky) column header — same column widths as the rows below */}
        <div className="sticky top-0 z-10 flex items-center whitespace-nowrap border-b border-zinc-800 bg-zinc-950 text-[10px] uppercase tracking-wider text-zinc-600">
          <span className="w-16 shrink-0 text-center">Action</span>
          <div className="flex min-w-0 flex-1 items-baseline gap-3 py-1.5 pr-3">
            <span className="w-20 shrink-0">Session</span>
            <span className="w-24 shrink-0">Project</span>
            <span className="min-w-0 flex-1">Description</span>
            <span className="w-24 shrink-0 text-right">Context</span>
            <span className="w-24 shrink-0 text-right">Last activity</span>
          </div>
        </div>
        <div className="divide-y divide-zinc-800/70">
          {rows.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-zinc-600">no sessions match this filter</p>
          ) : (
            rows.map((s) => (
              <div
                key={s.id}
                data-session-row
                className={`group/row flex items-center transition-colors ${
                  menuFor === s.id ? "bg-zinc-800/40" : "hover:bg-zinc-800/40"
                }`}
              >
                {/* action — the ⋯ kebab → dropdown (sidebar Recents menu), always shown */}
                <div className="flex w-16 shrink-0 items-center justify-center">
                  <button
                    onClick={(e) => openMenu(e, s.id)}
                    title="more actions"
                    aria-label="more actions"
                    className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <circle cx="5" cy="12" r="1.6" />
                      <circle cx="12" cy="12" r="1.6" />
                      <circle cx="19" cy="12" r="1.6" />
                    </svg>
                  </button>
                </div>
                <Link
                  href={openHref(s.id)}
                  scroll={false}
                  title="open this session in the terminal"
                  className="flex min-w-0 flex-1 items-baseline gap-3 py-2 pr-3"
                >
                  {/* session id — the session's name, the first-class identifier */}
                  <span className="flex w-20 shrink-0 items-baseline gap-1 truncate text-xs font-medium tabular-nums text-zinc-100">
                    {starred.has(s.id) && <span className="text-amber-400">★</span>}
                    {s.id.slice(0, 8)}
                  </span>
                  {/* project */}
                  <span
                    className={`w-24 shrink-0 truncate text-[11px] ${
                      s.project === "Unassigned" ? "text-zinc-600" : "text-zinc-400"
                    }`}
                  >
                    {s.project}
                  </span>
                  {/* description */}
                  <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
                    {s.snippet || "—"}
                  </span>
                  {/* ctx — amber when the 1M window is ~70%+ full */}
                  <span
                    className={`w-24 shrink-0 text-right text-[11px] tabular-nums ${
                      s.contextTokens >= CONTEXT_LIMIT * 0.7 ? "text-amber-500/90" : "text-zinc-500"
                    }`}
                  >
                    {s.contextTokens > 0 ? fmtTokens(s.contextTokens) : ""}
                  </span>
                  {/* last activity */}
                  <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-zinc-600">
                    {fmtAgo(now - s.lastActive)}
                  </span>
                </Link>
              </div>
            ))
          )}
        </div>
      </div>

      {/* the ⋯ dropdown — fixed so the scroll box can't clip it. One at a time. */}
      {menuSession && menuPos && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          className="fixed z-50 flex flex-col whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
        >
          <button
            role="menuitem"
            onClick={() => {
              router.push(openHref(menuSession.id), { scroll: false });
              closeMenu();
            }}
            className={menuItem}
          >
            Open
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const h = sessionParam
                ? `${pathname}?session=${sessionParam}&pair=${menuSession.id}`
                : `${pathname}?pair=${menuSession.id}`;
              router.push(h, { scroll: false });
              closeMenu();
            }}
            className={menuItem}
          >
            Open in Terminal 2
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const next = !starred.has(menuSession.id);
              setStarred((p) => {
                const n = new Set(p);
                if (next) n.add(menuSession.id);
                else n.delete(menuSession.id);
                return n;
              });
              postMeta(menuSession.id, { favorite: next });
              closeMenu();
            }}
            className={menuItem}
          >
            {starred.has(menuSession.id) ? "Unstar" : "Star"}
          </button>
          <div className="my-1 h-px bg-zinc-800" />
          <button
            role="menuitem"
            onClick={() => {
              setHidden((p) => new Set(p).add(menuSession.id));
              postMeta(menuSession.id, { hidden: true });
              closeMenu();
            }}
            className={menuItem}
          >
            Hide
          </button>
          <button
            role="menuitem"
            onClick={() => {
              navigator.clipboard.writeText(menuSession.id);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
            title={`click to copy ${menuSession.id}`}
            className={`${menuItem} font-mono text-[10px] text-zinc-500 hover:text-zinc-300`}
          >
            {copied ? "copied ✓" : `copy id · ${menuSession.id.slice(0, 8)}…`}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Terminal({
  paramKey = "session",
  initialFocus = true,
}: {
  // Which URL param this terminal reads/writes for its session. Terminal 1 (the
  // shell's always-mounted heart) uses "session"; Terminal 2 (the pair pane)
  // uses "pair", so the two never collide. API query params stay "session"
  // (that's the endpoint's name) — only the browser URL key changes.
  paramKey?: "session" | "pair";
  // Seeds focus mode from the `hq-focus` cookie (server-read in shell.tsx → no
  // flash). Focus is the DEFAULT (true); toggling to wide writes "0".
  initialFocus?: boolean;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sessionParam = params.get(paramKey);
  // the OTHER terminal's param — preserved whenever this one re-points, so
  // opening a session in one pane never closes the other.
  const sibling = params.get(paramKey === "session" ? "pair" : "session");
  // session id → href that re-points THIS terminal. Terminal 1 pins on the home
  // route (the /sessions panel was removed — the sidebar owns session selection
  // now); Terminal 2 sets ?pair on the current path while preserving T1's ?session.
  const hrefFor = (id: string) => {
    const sp = new URLSearchParams();
    if (paramKey === "session") {
      sp.set("session", id);
      if (sibling) sp.set("pair", sibling); // keep terminal 2 open
      return `/?${sp.toString()}`; // pin T1 on home (no panel)
    }
    if (sibling) sp.set("session", sibling); // keep terminal 1
    sp.set("pair", id);
    return `${pathname ?? "/"}?${sp.toString()}`;
  };
  // ?session=new = the "+" staging view: no session of its own. The stream
  // runs unpinned so the pane can flip to the newborn the moment it appears.
  const staged = sessionParam === "new";
  const pinned = staged ? null : sessionParam; // null = newest session
  // ?install=1 = preview the deployed install card locally (the empty-state the
  // terminal shows when there's no session — i.e. on a Vercel deploy).
  const previewInstall = params.get("install") === "1";
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [project, setProject] = useState("");
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState(""); // HQ rename (sidecar); shown in the header instead of the id
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null); // send box — for auto-grow
  const [savedNotes, setSavedNotes] = useState<Set<string>>(new Set()); // blocks saved as notes (keyed by text)
  // Per-block view state (favorite / hidden / 👍👎), keyed by the block's stable
  // id (jsonl uuid, falling back to its timestamp). Hydrated from the block-meta
  // sidecar whenever the shown session changes.
  const [blockMeta, setBlockMeta] = useState<Record<string, BlockMeta>>({});
  const [attachments, setAttachments] = useState<Attachment[]>([]); // staged screenshots
  const [dragOver, setDragOver] = useState<null | "file" | "todo">(null); // drop-zone hint
  const dragDepth = useRef(0); // enter/leave depth — kills the child-element flicker
  const fileInputRef = useRef<HTMLInputElement>(null); // hidden picker behind the 📎 button
  const [error, setError] = useState<string | null>(null);
  const [contextTokens, setContextTokens] = useState(0);
  const [model, setModel] = useState(""); // raw model id of the session's latest reply
  const [chosenModel, setChosenModel] = useState<string | null>(null); // picker override → --model on sends
  const [modelOpen, setModelOpen] = useState(false); // model dropdown open?
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const lineageRef = useRef<HTMLDetailsElement>(null); // /clear-chain menu — opens on hover (like PanelMenu)
  const [lastWrite, setLastWrite] = useState<number | null>(null);
  const [idCopied, setIdCopied] = useState(false); // header session-id copy flash
  const [focusMode, setFocusMode] = useState(initialFocus); // centered "conversation shell" — focus is the DEFAULT, seeded from the hq-focus cookie; the not-connected state forces it on regardless
  // "Live in HQ": HQ owns a warm REPL for this session — set true on the first
  // send (see doSend) and cleared on stop / session switch. PASSIVE status only:
  // the send box ALWAYS routes through the warm REPL now, so this no longer GATES
  // routing — it drives the SSE subscription (useRepl `enabled`), the live
  // overlay, and the header status pill ("live in HQ" vs "observing").
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState<string | null>(null); // a project being born-and-driven from the staging view
  const [searchQuery, setSearchQuery] = useState(""); // raw input — updates instantly so typing never lags
  const [appliedQuery, setAppliedQuery] = useState(""); // debounced — what the (heavy) DOM walk actually runs
  const [searchMode, setSearchMode] = useState(false); // send-box "search this session" mode — the box becomes the search bar
  const [searchUserOnly, setSearchUserOnly] = useState(false); // "filter by user" — scope hits to YOUR turns, skipping Claude + tool output
  const sendSearchInputRef = useRef<HTMLInputElement>(null); // send-box search field
  const [searchMatchCount, setSearchMatchCount] = useState(0); // hits in the transcript
  const [searchActiveIndex, setSearchActiveIndex] = useState(0); // which hit is current
  // The matched hits in document order, stored as (textNode, offset) — NOT live
  // Ranges — so the list is cheap to build over the whole transcript (incl. text
  // inside collapsed tool steps). Ranges are minted on demand for visible hits +
  // the active one; collapsed hits are revealed lazily when navigated to.
  const searchMatchesRef = useRef<{ node: Text; start: number }[]>([]);
  const openedDetailsRef = useRef<HTMLDetailsElement[]>([]); // tool steps we force-opened to reveal a hit
  const stoppedRef = useRef(false); // true when the user killed the run via stop
  const sendTargetRef = useRef<string | null>(null); // session the in-flight send went to
  const [escArmed, setEscArmed] = useState(false); // first Esc pressed, waiting for the second
  const [escNote, setEscNote] = useState<string | null>(null); // why Esc couldn't interrupt
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>(null); // live "working" status from the transcript
  // channel-in: a live push-channel is open for this session (from the turns poll).
  // When true the session is fork-free (push, not --resume), so it is NEVER `locked`
  // even mid-turn — and doSend routes through POST /api/channel instead of the warm REPL.
  const [channelConnected, setChannelConnected] = useState(false);
  // warn-before-fork: a non-channel-aware, not-yet-live session resume-FORKS on the
  // first send (a 2nd process on one transcript → the divergence net fires). `locked`
  // only blocks the WORKING case; an IDLE plain session would fork silently. So the
  // first such send is gated behind an explicit confirm. `forkWarn` holds the pending
  // target while the card is up; `forkAckRef` remembers sessions already acknowledged
  // (once per session — a nudge, not a nag).
  const [forkWarn, setForkWarn] = useState<string | null>(null);
  const forkAckRef = useRef<Set<string>>(new Set());
  const [interrupted, setInterrupted] = useState(false); // last turn ended on a hard interrupt
  // A rival (TUI) branch was written into the SAME transcript HQ is driving.
  // LATCHED: once raised it stays until the session switches or the user acts —
  // a later HQ write advances knownLeaf past the rival, so a stateless recompute
  // would otherwise drop the banner while the fork still exists.
  const [diverged, setDiverged] = useState<{ leaf?: string; preview?: string } | null>(null);
  // Sessions where the user already acknowledged the divergence banner. The rival
  // TUI writes a NEW leaf every turn, so re-latching per-leaf nags forever — once
  // dismissed, suppress it for that whole session (this tab's lifetime).
  const divergeAckRef = useRef<Set<string>>(new Set());
  const [resume, setResume] = useState<ResumeOptions>(null); // fresh-session resume options
  const [projects, setProjects] = useState<{ name: string; path: string }[]>([]); // launcher chips: history-derived {name, path}
  const [newProjectName, setNewProjectName] = useState(""); // "+ new project" input in the staging view
  const [newOpen, setNewOpen] = useState(false); // staging: the "+ new" chip expanded into its input
  // staging PROJECTS grid: clamped to 2 rows, a chevron reveals the rest.
  const [projExpanded, setProjExpanded] = useState(false);
  const [projOverflow, setProjOverflow] = useState(false); // chips hidden beyond the 2-row clamp?
  const projGridRef = useRef<HTMLDivElement>(null);
  // staging: the chosen launch target (an existing chip or a to-be-created project).
  // null = the ~/hq default. Clicking a chip SELECTS; the actual launch happens only
  // on send — so a stray click can never start a session (the footgun fix).
  const [selectedTarget, setSelectedTarget] = useState<
    { name: string; cwd?: string; newProject?: string } | null
  >(null);
  const [lineage, setLineage] = useState<Lineage>(null); // this session's /clear chain
  const [predecessorCtx, setPredecessorCtx] = useState(0); // continued session's ctx size (fresh pane)
  const [now, setNow] = useState(0); // ticks every 1s while working, for elapsed
  // Does the clamped PROJECTS grid hide any chips (a row 3+)? Drives whether the
  // "more" chevron shows — never offer to expand when there's nothing hidden.
  useEffect(() => {
    const el = projGridRef.current;
    if (!staged || !el || projExpanded) return;
    const check = () => setProjOverflow(el.scrollHeight - el.clientHeight > 4);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [staged, projects.length, projExpanded]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Scrollback + bottom-follow. atBottomRef: is the view parked at the bottom (so
  // live turns only auto-scroll then, never yanking you while you read up top).
  // expandedRef: full history loaded (lazy, on scroll-to-top). anchorRef:
  // scrollHeight captured before a prepend, to restore your position after it.
  const atBottomRef = useRef(true);
  const suppressJumpRef = useRef(false); // keep the arrow hidden during a smooth scroll-to-bottom
  const expandedRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const anchorRef = useRef(0); // scrollHeight captured before a prepend
  const anchorLenRef = useRef(0); // item count when the prepend was requested
  const itemsLenRef = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const busyRef = useRef(false); // true mid-send → don't let a stream tick clobber the optimistic turns
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null); // pending refetch retry
  // CODE-REVIEW FE-1/FE-2: loadTurns gets called concurrently (SSE change + the
  // 1s working tick + a reconnect can overlap). Without a guard a slow earlier
  // response can land last and win (stale flicker), and an in-flight fetch for a
  // session you just left can write into shared state. loadSeqRef bumps per call
  // so only the LATEST response commits; loadAbortRef aborts the prior request;
  // loadQueryRef pins the target (the query encodes session/staged/sibling) so a
  // response for a since-switched target is dropped even if it wasn't aborted.
  const loadSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadQueryRef = useRef<string>("");
  const stagedAtRef = useRef(0); // when the "+" staging view was entered
  const rootRef = useRef<HTMLDivElement>(null); // pane root — to reach the enclosing boundary box
  const wasThinkingRef = useRef(false); // tracks the working→done edge for the green flash
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // debounce orange→green
  const dismissRef = useRef<(() => void) | null>(null); // detaches the held-green engagement listeners
  const working = status !== null;
  // Locked = a non-live (HQ doesn't own it) session that's mid-turn: sending would
  // --resume a SECOND process and interleave/corrupt. The send box disables until it
  // goes idle. EXEMPTION (channel-in): a channel-connected session is driven by PUSH
  // (POST /api/channel), not --resume, so it is fork-free and NEVER locked even while
  // busy — that is the whole point of channel-in. This supersedes the old "any
  // non-live busy session reads locked" caveat: a session with a live push-channel
  // (detected via channelConnected from the turns poll) stays sendable mid-turn.
  const locked = !live && !channelConnected && working;
  itemsLenRef.current = items.length; // latest item count, for the scrollback anchor
  // CODE-REVIEW FE-5: the Esc handler used to bind on EVERY render (no deps) so
  // its closures stayed fresh, but the terminal re-renders every 1s while working
  // and on every keystroke — that's a lot of add/removeEventListener churn. Keep
  // the fresh values in refs instead and bind the listener once (see below).
  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  const workingRef = useRef(working);
  workingRef.current = working;
  const escArmedRef = useRef(escArmed);
  escArmedRef.current = escArmed;
  const stopSendRef = useRef<() => void>(() => {});

  // Live REPL — the send box ALWAYS routes here now (both terminals, any real
  // pinned session). `live` flips true on the first send (doSend / birthAndDrive),
  // which opens the SSE so streamed tokens + tool-permission cards surface. Warm-
  // on-first-send (not warm-on-pin): enabling on every clicked session would
  // recordDriven() orphan processes + churn Recents — so the SSE opens only for
  // sessions you actually sent to, which also makes "observing"→"live" meaningful.
  const drivenSessionRef = useRef<string | null>(null); // which session `live` was turned on FOR
  // The REPL hook MUST target the same id doSend/stopSend use for the optimistic
  // turn + refs + guard: `pinned ?? resolvedId`. `pinned` updates immediately from
  // the URL on a session switch, while `resolvedId` only catches up via the poll
  // (gated by !busyRef). Keying on `resolvedId` alone let `repl.send`/`repl.stop`
  // POST a STALE session during the switch window while the optimistic turn
  // rendered under the new `pinned` — the send landed in the wrong transcript.
  const replTarget = pinned ?? resolvedId;
  const repl = useRepl(replTarget, live && !!replTarget);
  // `live` is PER-SESSION: switching the pinned session resets it, so HQ never
  // keeps claiming "live" for a session you navigated away from. `pinned` is
  // immediate (URL), so it doesn't false-trip during the birth→navigate handoff.
  useEffect(() => {
    if (live && pinned && drivenSessionRef.current && pinned !== drivenSessionRef.current) {
      setLive(false);
      drivenSessionRef.current = null;
    }
  }, [pinned, live]);
  // Clear the divergence latch on a session switch — keyed PURELY on the pin, NOT
  // folded into the live-gated effect above. The banner latches while merely
  // OBSERVING (detection rides the poll regardless of `live`), and
  // drivenSessionRef is null until you send — so a live-gated clear would strand
  // a stale banner when you observe→switch without ever sending. This fires on
  // every pin change; loadTurns then refetches and re-latches if the new session
  // also diverged. Same-session polls don't change `pinned`, so the latch holds.
  useEffect(() => {
    setDiverged(null);
  }, [pinned]);
  // Optimistic in-flight (`sending`/`busyRef`) is set synchronously in doSend so
  // the stop button + flash morph instantly; the REPL's own `busy` lags the SSE
  // round-trip. Clear them on repl.busy's TRUE→FALSE edge (a turn finished) —
  // tracked via a prev-busy ref so the initial busy=false doesn't clear them
  // before the send even lands. Failure paths are covered explicitly, NOT by the
  // poll: if repl.send's POST fails (or sendTurn returns {ok:false}), busy never
  // rises over SSE, so use-repl lowers it on the failed POST AND doSend clears the
  // flags + surfaces an error inline; stop clears them outright.
  const prevReplBusyRef = useRef(false);
  useEffect(() => {
    if (prevReplBusyRef.current && !repl.busy) {
      setSending(false);
      busyRef.current = false;
    }
    prevReplBusyRef.current = repl.busy;
  }, [repl.busy]);

  // In-session find-in-page. `q` is the DEBOUNCED query — the heavy DOM walk +
  // highlight build runs off this, so typing into the box stays instant even on a
  // huge transcript (the input is driven by `searchQuery`, which updates every
  // keystroke). Per-pane highlight keys (Terminal 1 = "session", 2 = "pair") keep
  // the two terminals from clobbering each other's registry entries.
  const q = appliedQuery.trim().toLowerCase();
  // The highlight engine lights up when the send-box search mode has a query.
  const searchActive = searchMode && q.length > 0;
  const hlName = `hq-search-${paramKey}`;
  const hlActiveName = `hq-search-active-${paramKey}`;
  // Exit the send-box search mode → back to compose (clears the query so the
  // highlights drop too).
  const closeSendSearch = useCallback(() => {
    setSearchMode(false);
    setSearchQuery("");
    setAppliedQuery("");
  }, []);
  // Step to the next / previous hit, wrapping around.
  const gotoMatch = useCallback((dir: 1 | -1) => {
    setSearchActiveIndex((i) => {
      const n = searchMatchesRef.current.length;
      return n ? (i + dir + n) % n : 0;
    });
  }, []);

  // A hit is visible iff none of its ancestor <details> (tool steps) are closed.
  const isHitVisible = useCallback((node: Node) => {
    const container = scrollRef.current;
    let el = node.parentElement;
    while (el && el !== container) {
      if (el.tagName === "DETAILS" && !(el as HTMLDetailsElement).open)
        return false;
      el = el.parentElement;
    }
    return true;
  }, []);

  // Register the base highlight for every CURRENTLY-visible hit (collapsed ones
  // are skipped here — they light up once navigation reveals them).
  const registerVisibleHighlights = useCallback(() => {
    const api = highlightApi();
    if (!api) return;
    const len = q.length;
    const ranges: Range[] = [];
    for (const m of searchMatchesRef.current) {
      if (!isHitVisible(m.node)) continue;
      try {
        const r = document.createRange();
        r.setStart(m.node, m.start);
        r.setEnd(m.node, m.start + len);
        ranges.push(r);
      } catch {
        /* node went stale (live tail rewrote the DOM) — skip it */
      }
    }
    if (ranges.length) api.reg.set(hlName, new api.Ctor(...ranges));
    else api.reg.delete(hlName);
  }, [q, hlName, isHitVisible]);

  // Debounce the raw input into the applied query — the expensive search only
  // recomputes ~250ms after you stop typing, never mid-keystroke.
  useEffect(() => {
    const t = setTimeout(() => setAppliedQuery(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // A new applied query always starts back at the first hit.
  useEffect(() => {
    setSearchActiveIndex(0);
  }, [q]);

  // Focus the send-box search field the moment the box flips into search mode.
  useEffect(() => {
    if (searchMode) sendSearchInputRef.current?.focus();
  }, [searchMode]);

  // Turn-state border (Terminal 1 only for now): drive THIS pane's own boundary
  // box off the turn lifecycle. ORANGE while the user awaits a COMPLETE response
  // — `working` (the ✶ status: thinking / writing / tool calls / API, the whole
  // turn) OR a local send in flight. On a clean finish → GREEN, held until the
  // user engages (mouse over the terminal, or any click / keypress / scroll), then
  // it fades to gray. On a HARD INTERRUPT → RED, held until the user sends new
  // input (NOT dismissed by mere engagement — a stopped turn needs fresh
  // direction, so it stays loud until you give it). A short debounce on the clean
  // finish keeps brief gaps between phases from flashing green early. closest()
  // scopes it to this terminal's box, so it never colors a sibling pane.
  useEffect(() => {
    if (paramKey !== "session") return;
    const box = rootRef.current?.closest(".boundary-flash");
    if (!box) return;
    const awaiting = working || sending;

    if (awaiting) {
      if (doneTimerRef.current) {
        clearTimeout(doneTimerRef.current); // we're active again → cancel any pending finish
        doneTimerRef.current = null;
      }
      dismissRef.current?.(); // tear down a prior held-green's listeners, if any
      box.classList.add("is-thinking"); // orange
      box.classList.remove("is-done", "is-interrupted");
      wasThinkingRef.current = true;
      return;
    }

    if (interrupted) {
      // Hard interrupt → RED, held until the next input (the awaiting branch above
      // clears it). No engagement dismissal — the user must notice + redirect.
      if (doneTimerRef.current) {
        clearTimeout(doneTimerRef.current);
        doneTimerRef.current = null;
      }
      dismissRef.current?.(); // drop any held-green listeners
      box.classList.remove("is-thinking", "is-done");
      box.classList.add("is-interrupted");
      wasThinkingRef.current = false; // consumed — don't also schedule green
      return;
    }

    if (!wasThinkingRef.current) return; // wasn't mid-turn → nothing to acknowledge
    if (doneTimerRef.current) return; // a finish is already pending

    // Debounce: only declare the turn done after the await has stayed clear for a
    // beat — a gap between thinking → tool → writing shouldn't blink green.
    doneTimerRef.current = setTimeout(() => {
      doneTimerRef.current = null;
      wasThinkingRef.current = false;
      box.classList.remove("is-thinking");
      box.classList.add("is-done"); // orange → held green (pulse + green chips)
      const root = rootRef.current;
      const dismiss = () => {
        box.classList.remove("is-done"); // → border transition fades green to gray
        root?.removeEventListener("pointermove", dismiss);
        window.removeEventListener("pointerdown", dismiss);
        window.removeEventListener("keydown", dismiss);
        window.removeEventListener("wheel", dismiss);
        dismissRef.current = null;
      };
      dismissRef.current = dismiss;
      root?.addEventListener("pointermove", dismiss); // mousing over the terminal
      window.addEventListener("pointerdown", dismiss); // a click anywhere
      window.addEventListener("keydown", dismiss); // a keypress anywhere
      window.addEventListener("wheel", dismiss, { passive: true }); // a scroll
    }, 700);

    // Re-run (next turn) / unmount: cancel a pending finish + drop held-green.
    return () => {
      if (doneTimerRef.current) {
        clearTimeout(doneTimerRef.current);
        doneTimerRef.current = null;
      }
      dismissRef.current?.();
    };
  }, [working, sending, interrupted, paramKey]);

  // Inject the runtime <style> on mount so the turn-state border/pulse/chip rules
  // exist the instant `.is-thinking`/`.is-done` get toggled (id-guarded; the two
  // panes share one tag).
  useEffect(() => {
    ensureTerminalRuntimeStyle();
  }, []);

  // Latest pathname in a ref so loadTurns can build re-pin URLs WITHOUT listing
  // `pathname` as a dependency. Otherwise a panel-route change (tabbing through
  // Activity/Metrics/Console, which swaps the @panel route segment) recreates
  // loadTurns → re-fires the backfill → the terminal flashes/jumps even though
  // its session never changed. Search's scope chips don't jump because they keep
  // the same pathname (only ?scope changes); this gives the route-group panels
  // that same stability — the terminal only re-fetches when ITS session changes.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const loadTurns = useCallback(async function load() {
    const q = staged
      ? "?staged=1"
      : pinned
        ? `?session=${encodeURIComponent(pinned)}`
        : sibling
          ? `?exclude=${encodeURIComponent(sibling)}` // unpinned: newest, but not Terminal 2's
          : "";
    // Once you've scrolled back to load full history, keep polling the full list
    // (cached by mtime) so live turns merge onto it instead of snapping to a tail.
    const fullQ = expandedRef.current ? (q ? "&full=1" : "?full=1") : "";
    // CODE-REVIEW FE-1/FE-2: claim this call as the latest, record its target,
    // and abort any in-flight fetch so a slow earlier response can't land last.
    const mySeq = ++loadSeqRef.current;
    loadQueryRef.current = q;
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    try {
      const d = await (await fetch(`/api/terminal/turns${q}${fullQ}`, { signal: ac.signal })).json();
      // Superseded by a newer call, or the target changed out from under us
      // (session switch) — drop this response rather than write stale state.
      if (mySeq !== loadSeqRef.current || loadQueryRef.current !== q) return;
      if (staged) {
        // Staging view: don't display the newest session — just keep the
        // recent-sessions list fresh and watch for a newborn (a session born
        // after staging). The moment one appears, flip to it.
        setResume(d.resume ?? null);
        setProjects(d.projects ?? []);
        setNow(Date.now());
        if (d.id && (d.bornAt ?? 0) > stagedAtRef.current)
          router.replace(`${pathnameRef.current}?session=${d.id}`, { scroll: false });
        return;
      }
      // Mid-send, the optimistic items own the view — but always refresh status
      // so the live "working" line shows even while a send is in flight.
      if (!busyRef.current) {
        // CODE-REVIEW FE-2 (items growth): NOT capped on purpose. When NOT
        // expanded the API already returns only a tail, so `items` is bounded
        // there; the unbounded case is expandedRef === true, which IS the
        // "scroll to top = full history" feature — a tail cap would silently
        // truncate it. The server caches the full list by mtime, so the cost is
        // re-render, not re-fetch. Capping safely needs windowed rendering (out
        // of scope for a surgical fix), so left intact.
        setItems(d.items ?? []);
        setHasMore(d.more ?? false);
        setProject(d.project ?? "");
        setResolvedId(d.id ?? null);
        setCustomTitle(d.customTitle ?? "");
        setResume(d.resume ?? null);
        setLineage(d.lineage ?? null);
        setPredecessorCtx(d.predecessorCtx ?? 0);
        // Sticky: an unpinned terminal pins itself to the session it just
        // resolved, so it STAYS there — clicking a Recents row is the only thing
        // that moves it, instead of live-chasing whatever session is newest.
        if (!pinned && d.id) {
          const sp = new URLSearchParams();
          sp.set(paramKey, d.id);
          const sibKey = paramKey === "session" ? "pair" : "session";
          if (sibling) sp.set(sibKey, sibling);
          router.replace(`${pathnameRef.current ?? "/"}?${sp.toString()}`, { scroll: false });
        }
      }
      setStatus(d.status ?? null);
      // OUTSIDE the busyRef gate (above) on purpose: the fork-lock exemption needs
      // this fresh DURING an in-flight send (exactly when `locked` is read), and a
      // channel push to a busy session keeps it true across the working-tick.
      setChannelConnected(d.channelConnected ?? false);
      setInterrupted(d.interrupted ?? false);
      // LATCH the divergence net: raise on a rival, but NEVER clear on !diverged
      // here — HQ's next write advances knownLeaf past the rival, so a server
      // recompute returns diverged:false while the fork still exists. The latch
      // clears only on session-switch (the [pinned] effect) or an explicit action.
      if (d.diverged && !divergeAckRef.current.has(pinned ?? d.id ?? ""))
        setDiverged({ leaf: d.rivalLeafUuid, preview: d.rivalPreview });
      setContextTokens(d.contextTokens ?? 0);
      setModel(d.model ?? "");
      setLastWrite(d.lastWrite || null);
      setNow(Date.now());
    } catch {
      // CODE-REVIEW FE-1: an abort (superseded call / session switch) is
      // intentional — don't schedule a retry for it, and don't retry if a newer
      // call already superseded us.
      if (ac.signal.aborted || mySeq !== loadSeqRef.current) return;
      // Transient (dev recompile mid-fetch). Retry shortly — the stream won't
      // re-ping until the NEXT transcript write, which can be minutes away
      // (the post-/clear stale-terminal bug).
      if (!retryRef.current)
        retryRef.current = setTimeout(() => {
          retryRef.current = null;
          load();
        }, 2000);
    }
  }, [pinned, staged, router, sibling, paramKey]);

  // Lazy scrollback: at the top, load the FULL transcript once and prepend it.
  // anchorRef (set here, applied in the layout effect below) keeps your reading
  // position fixed as older content slots in above.
  const loadOlder = useCallback(() => {
    if (expandedRef.current || loadingOlderRef.current || !hasMore) return;
    loadingOlderRef.current = true;
    anchorRef.current = scrollRef.current?.scrollHeight ?? 0;
    anchorLenRef.current = itemsLenRef.current;
    expandedRef.current = true;
    loadTurns().finally(() => {
      loadingOlderRef.current = false;
    });
  }, [hasMore, loadTurns]);

  // Search mode → pull the FULL transcript so find-in-page covers everything,
  // not just the loaded tail. loadOlder no-ops if already expanded / nothing more.
  useEffect(() => {
    if (searchMode) loadOlder();
  }, [searchMode, loadOlder]);

  // Build the match list for the active query across the WHOLE transcript — text
  // inside collapsed tool steps included. Cheap on purpose: one TreeWalker pass of
  // (node, offset) pairs, NO per-step textContent serialization and NOTHING opened
  // — so it stays snappy regardless of transcript size or hit count. Only visible
  // hits get highlighted now; collapsed ones are revealed lazily on navigation.
  useEffect(() => {
    const api = highlightApi();
    const container = scrollRef.current;
    // Clear any prior accordion match-borders before re-marking (or on close).
    container
      ?.querySelectorAll("details[data-hq-match]")
      .forEach((d) => d.removeAttribute("data-hq-match"));
    if (!api || !container || !searchActive) {
      api?.reg.delete(hlName);
      api?.reg.delete(hlActiveName);
      searchMatchesRef.current = [];
      setSearchMatchCount(0);
      openedDetailsRef.current.forEach((d) => (d.open = false)); // re-collapse what nav opened
      openedDetailsRef.current = [];
      return;
    }
    ensureTerminalRuntimeStyle(); // the highlight + state styling lives in a runtime <style>
    const matches: { node: Text; start: number }[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const v = node.nodeValue;
        return v && v.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.nodeValue ?? "").toLowerCase();
      // "Filter by user": keep a hit only if its nearest [data-role] ancestor
      // is a user turn. Claude replies are data-role="assistant"; tool output
      // and dividers have no [data-role] at all — both fall away here.
      if (searchUserOnly) {
        const owner = node.parentElement?.closest("[data-role]");
        if (owner?.getAttribute("data-role") !== "user") continue;
      }
      for (
        let idx = text.indexOf(q);
        idx !== -1;
        idx = text.indexOf(q, idx + q.length)
      ) {
        matches.push({ node: node as Text, start: idx });
      }
    }
    searchMatchesRef.current = matches;
    // Border every tool-step accordion that contains a match — even collapsed
    // ones — so the user sees which section holds the keyword.
    const markedSeen = new Set<Element>();
    for (const m of matches) {
      let el: Element | null = m.node.parentElement;
      while (el && el !== container) {
        if (el.tagName === "DETAILS" && !markedSeen.has(el)) {
          markedSeen.add(el);
          el.setAttribute("data-hq-match", "");
        }
        el = el.parentElement;
      }
    }
    registerVisibleHighlights();
    setSearchMatchCount(matches.length);
    setSearchActiveIndex((i) =>
      matches.length ? Math.min(i, matches.length - 1) : 0,
    );
  }, [
    searchActive,
    q,
    items,
    searchUserOnly,
    hlName,
    hlActiveName,
    registerVisibleHighlights,
  ]);

  // Manual-expand re-paint: registerVisibleHighlights skips matches inside a
  // COLLAPSED tool step, and otherwise only re-runs when match-nav opens one. So
  // opening a collapsed <details> BY HAND would leave the matches it reveals
  // unpainted (they're counted, but the yellow never lands) until you navigate.
  // `toggle` doesn't bubble — capture it on the container — and re-light on every
  // open/close so revealed hits paint and hidden ones drop.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !searchActive) return;
    const onToggle = () => registerVisibleHighlights();
    container.addEventListener("toggle", onToggle, true);
    return () => container.removeEventListener("toggle", onToggle, true);
  }, [searchActive, registerVisibleHighlights]);

  // Navigate to the active hit: reveal it if it's tucked inside a collapsed tool
  // step (then re-light the now-visible siblings), paint it the brighter active
  // shade, and scroll it a third of the way down for context.
  useEffect(() => {
    const api = highlightApi();
    const container = scrollRef.current;
    if (!api || !container) return;
    const matches = searchMatchesRef.current;
    if (!searchActive || matches.length === 0) {
      api.reg.delete(hlActiveName);
      return;
    }
    const m = matches[Math.min(searchActiveIndex, matches.length - 1)];
    // Reveal-on-navigate (Chrome-find style): open any collapsed <details> hiding
    // this hit, then refresh the base highlights so its newly-visible siblings show.
    let opened = false;
    let el = m.node.parentElement;
    while (el && el !== container) {
      if (el.tagName === "DETAILS" && !(el as HTMLDetailsElement).open) {
        (el as HTMLDetailsElement).open = true;
        openedDetailsRef.current.push(el as HTMLDetailsElement);
        opened = true;
      }
      el = el.parentElement;
    }
    if (opened) registerVisibleHighlights();
    let range: Range;
    try {
      range = document.createRange();
      range.setStart(m.node, m.start);
      range.setEnd(m.node, m.start + q.length);
    } catch {
      return; // node went stale
    }
    const hl = new api.Ctor(range);
    hl.priority = 1; // outrank the base highlight where they overlap
    api.reg.set(hlActiveName, hl);
    const rr = range.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    if (rr.height || rr.width) {
      container.scrollTo({
        top: container.scrollTop + (rr.top - cr.top) - container.clientHeight / 3,
        behavior: "smooth",
      });
    }
  }, [
    searchActiveIndex,
    searchMatchCount,
    searchActive,
    hlActiveName,
    q,
    registerVisibleHighlights,
  ]);

  // Tidy the global highlight registry when this pane unmounts.
  useEffect(
    () => () => {
      const api = highlightApi();
      api?.reg.delete(`hq-search-${paramKey}`);
      api?.reg.delete(`hq-search-active-${paramKey}`);
    },
    [paramKey],
  );

  // Entering the staging view: clear the display (nothing is being shown) and
  // stamp the moment — only sessions born after it count as the newborn.
  useEffect(() => {
    if (!staged) return;
    stagedAtRef.current = Date.now();
    setItems([]);
    setProject("");
    setResolvedId(null);
    setCustomTitle("");
    setLineage(null);
    setStatus(null);
    setContextTokens(0);
    setModel("");
    setLastWrite(null);
    setResume(null);
    setPredecessorCtx(0);
  }, [staged]);

  // The model picker override is per-session — clear it when the pin changes.
  useEffect(() => {
    setChosenModel(null);
  }, [pinned]);

  // Close the model dropdown on an outside click.
  useEffect(() => {
    if (!modelOpen) return;
    const onDown = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node))
        setModelOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [modelOpen]);

  // Backfill on mount and whenever the pinned session changes.
  useEffect(() => {
    setLoading(true);
    setError(null);
    expandedRef.current = false; // new session → start at the tail, not full history
    atBottomRef.current = true;
    setShowJump(false);
    loadTurns().finally(() => setLoading(false));
  }, [loadTurns]);

  // Live tail: refetch the parsed turns whenever the transcript changes. Skipped
  // while a local send is in flight (the optimistic turns own the view then).
  useEffect(() => {
    const q = pinned ? `?session=${encodeURIComponent(pinned)}` : "";
    const es = new EventSource(`/api/terminal/stream${q}`);
    // Re-sync on every (re)connect, not just on change: a dropped stream (dev
    // recompile, laptop sleep) misses events, and the route's baseline resets
    // on reconnect — so a /clear during the gap never fires `change` and the
    // terminal shows the dead session until something else writes (image #52).
    es.addEventListener("ready", () => loadTurns());
    es.addEventListener("change", () => loadTurns());
    return () => {
      es.close();
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, [pinned, loadTurns]);

  // While a turn is in flight, tick every 1s — bumps `now` (smooth elapsed) and
  // refetches status (live tokens/phase, even between stream writes).
  useEffect(() => {
    if (!working) return;
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      loadTurns();
    }, 1000);
    return () => clearInterval(t);
  }, [working, loadTurns]);

  // Slow tick while idle so the "last activity Nm ago" line stays honest even
  // after the cache countdown's 1s tick stops.
  useEffect(() => {
    if (working) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [working]);

  // Tick 1s while the cache window is open and the session is idle, so the
  // countdown stays live (the working effect already ticks mid-turn).
  useEffect(() => {
    if (working || !lastWrite || Date.now() - lastWrite >= CACHE_TTL_MS) return;
    setNow(Date.now());
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - lastWrite >= CACHE_TTL_MS) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [working, lastWrite]);

  // Cold flash: the instant the countdown hits 0, show "cold" in blue, then fade
  // it out and vanish (~5s total). The 1s tick above STOPS at expiry, so this
  // can't ride `now` — it's an edge-detected one-shot: armed while warm, fired
  // the moment the window closes, and only when it JUST closed (the 2s guard
  // keeps a load into an already-cold cache from flashing).
  const [coldFlash, setColdFlash] = useState<"off" | "on" | "out">("off");
  const coldFiredRef = useRef(false);
  // CODE-REVIEW FE-6: the firing DECISION still rides `now` (it needs the 2s
  // "just closed" window) but no longer owns the fade timers — it only bumps
  // coldFireSeq, which arms the timeline below. Re-running on a `now` tick used
  // to tear down the out/gone timers; now the timeline lives in its own effect
  // keyed on that seq, so an unrelated 1s/30s tick can't clear them mid-fade.
  const [coldFireSeq, setColdFireSeq] = useState(0);
  useEffect(() => {
    const cl =
      !working && lastWrite !== null && now > 0
        ? CACHE_TTL_MS - (now - lastWrite)
        : null;
    if (cl !== null && cl > 0) {
      coldFiredRef.current = false; // warm → re-arm for the next expiry
      setColdFlash((s) => (s === "off" ? s : "off"));
      return;
    }
    if (cl === null || coldFiredRef.current || -cl >= 2000) return;
    coldFiredRef.current = true;
    setColdFireSeq((n) => n + 1); // arm the fade timeline (below)
  }, [working, lastWrite, now]);

  // CODE-REVIEW FE-6: the fade timeline, isolated from the `now` tick — keyed on
  // the fire seq (NOT coldFlash, which it sets itself), so its own on→out→off
  // state changes don't tear it down. Runs once per fire: on → 3s hold → out
  // (fade) → gone by 5s → off.
  useEffect(() => {
    if (coldFireSeq === 0) return; // not yet fired
    setColdFlash("on");
    const out = setTimeout(() => setColdFlash("out"), 3000); // hold, then fade
    const gone = setTimeout(() => setColdFlash("off"), 5000); // unmount by 5s
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [coldFireSeq]);

  // Bottom-follow: only auto-scroll when you're already at the bottom — a live turn
  // lands in view if you're watching, but never yanks you down while you read up top.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [items, sending, status]);

  // After a scroll-to-top prepend (loadOlder), restore the prior scroll position so
  // older content slots in above without the view jumping.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    // Only the actual prepend (item count grew past the request-time count) consumes
    // the anchor — a concurrent tail-poll landing mid-expand won't steal it.
    if (el && anchorRef.current > 0 && items.length > anchorLenRef.current) {
      el.scrollTop += el.scrollHeight - anchorRef.current;
      anchorRef.current = 0;
    }
  });

  // Esc parity with the real CLI: first Esc arms ("press esc again to
  // interrupt"), second Esc within 2s interrupts. HQ can only kill runs it
  // spawned — for an external turn the second Esc says so instead of lying.
  // CODE-REVIEW FE-5: bound ONCE ([] deps) — the handler reads sending/working/
  // escArmed/stopSend from refs (synced each render above) so it stays fresh
  // without rebinding the listener on every 1s tick / keystroke.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (!sendingRef.current && !workingRef.current) return;
      if (escTimer.current) clearTimeout(escTimer.current);
      if (!escArmedRef.current) {
        setEscArmed(true);
        escTimer.current = setTimeout(() => setEscArmed(false), 2000);
        return;
      }
      setEscArmed(false);
      if (sendingRef.current) {
        stopSendRef.current();
      } else {
        setEscNote(
          "this turn is running in its own terminal — HQ can only interrupt runs it started"
        );
        escTimer.current = setTimeout(() => setEscNote(null), 4000);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Browser default on a dropped file = navigate the tab to it, nuking HQ. Guard
  // the whole window so a stray drop OUTSIDE a terminal pane (sidebar, gaps) is a
  // no-op, not a navigation. Per-instance + idempotent: two terminals install two
  // identical preventDefault listeners, which is harmless. Files only — internal
  // drags pass through untouched.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (isFileDrag(e.dataTransfer)) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // Compose "Send to terminal": the Compose tray dispatches hq:compose with the
  // assembled text; the PRIMARY terminal (Terminal 1) drops it into its message
  // box. Decoupled via a window event so the panel never prop-drills into here.
  useEffect(() => {
    if (paramKey !== "session") return; // Compose targets Terminal 1 for now
    const onCompose = (e: Event) => {
      const text = (e as CustomEvent).detail?.text;
      if (typeof text === "string" && text)
        setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, "")}\n${text}` : text));
    };
    window.addEventListener("hq:compose", onCompose);
    return () => window.removeEventListener("hq:compose", onCompose);
  }, [paramKey]);

  // Capture the current draft as a to-do on the HQ list, then clear the box.
  async function todoDraft() {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    try {
      await fetch("/api/todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: t,
          addedBy: "you",
          fromSession: resolvedId ?? undefined,
        }),
      });
    } catch {
      setError("couldn't add to-do");
    }
  }

  // Save a message block as a searchable note (.md under ~/.claude/hq/notes) so
  // a good reply is findable later without scrolling the transcript.
  async function saveNoteBlock(it: { text: string; role?: string; at?: string }) {
    if (!it.text?.trim() || savedNotes.has(it.text)) return;
    setSavedNotes((s) => new Set(s).add(it.text)); // optimistic — green check + blue border
    try {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: it.text,
          role: it.role,
          at: it.at,
          sessionId: pinned ?? resolvedId,
          project,
        }),
      });
    } catch {
      setError("couldn't save note");
    }
  }

  // ── Per-block actions (favorite / hide / 👍👎 / save-as-code) ──────────────
  type TurnItem = Extract<TimelineItem, { kind: "turn" }>;
  // The block id used to key block-meta: the source jsonl uuid, falling back to
  // the timestamp (items that predate uuid plumbing still key on `at`).
  const blockKey = (it: { uuid?: string; at?: string }) => it.uuid || it.at || "";

  // Hydrate this session's block-meta whenever the shown session changes.
  const metaSessionId = pinned ?? resolvedId;
  useEffect(() => {
    if (!metaSessionId) {
      setBlockMeta({});
      return;
    }
    let alive = true;
    fetch(`/api/block-meta?session=${encodeURIComponent(metaSessionId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setBlockMeta(d.meta ?? {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [metaSessionId]);

  // Optimistically merge a patch onto a block's meta, then persist it. A 👍/👎
  // also carries the block text so the server can log it to feedback.jsonl.
  async function patchBlock(
    id: string,
    text: string,
    patch: { favorite?: boolean; hidden?: boolean; reaction?: Reaction | null },
  ) {
    const sessionId = pinned ?? resolvedId;
    if (!sessionId || !id) return;
    setBlockMeta((m) => {
      const next = { ...m };
      const cur: BlockMeta = { ...(next[id] ?? {}) };
      if (typeof patch.favorite === "boolean") {
        if (patch.favorite) cur.favorite = true;
        else delete cur.favorite;
      }
      if (typeof patch.hidden === "boolean") {
        if (patch.hidden) cur.hidden = true;
        else delete cur.hidden;
      }
      if (patch.reaction !== undefined) {
        if (patch.reaction) cur.reaction = patch.reaction;
        else delete cur.reaction;
      }
      if (Object.keys(cur).length === 0) delete next[id];
      else next[id] = cur;
      return next;
    });
    try {
      await fetch("/api/block-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          blockId: id,
          ...patch,
          text: patch.reaction ? text : undefined,
          project,
        }),
      });
    } catch {
      /* optimistic update stands; a failed persist self-heals on reload */
    }
  }

  const toggleBlockFavorite = (it: TurnItem) =>
    patchBlock(blockKey(it), it.text, { favorite: !blockMeta[blockKey(it)]?.favorite });
  const toggleBlockHidden = (it: TurnItem) =>
    patchBlock(blockKey(it), it.text, { hidden: !blockMeta[blockKey(it)]?.hidden });
  const reactToBlock = (it: TurnItem, r: Reaction) =>
    patchBlock(blockKey(it), it.text, {
      reaction: blockMeta[blockKey(it)]?.reaction === r ? null : r,
    });
  // Tool steps key block-meta on their tool_use id; the saved content is the detail.
  type ToolItem = Extract<TimelineItem, { kind: "tool" }>;
  const toggleToolFavorite = (it: ToolItem) =>
    patchBlock(it.id, it.detail, { favorite: !blockMeta[it.id]?.favorite });
  const toggleToolHidden = (it: ToolItem) =>
    patchBlock(it.id, it.detail, { hidden: !blockMeta[it.id]?.hidden });

  // "Save as code": pull the fenced code from a reply (fallback: the whole block)
  // and save it as a note that renders as a clean, copy-pasteable code block.
  async function saveCodeBlock(it: { text: string; role?: string; at?: string }) {
    if (!it.text?.trim()) return;
    const fences = [...it.text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) =>
      m[1].replace(/\s+$/, ""),
    );
    const code = (fences.length ? fences.join("\n\n") : it.text).trim();
    const text = `Code · ${project || it.role || "session"}\n\n\`\`\`\n${code}\n\`\`\``;
    try {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          role: it.role,
          at: it.at,
          sessionId: pinned ?? resolvedId,
          project,
        }),
      });
    } catch {
      setError("couldn't save code");
    }
  }

  // One transcript turn: the "● claude · time" header (with a ★ when favorited),
  // then the block — or, when hidden, a collapsed "hidden block · show" stub that
  // keeps it out of view without removing it from the transcript.
  const renderTurn = (it: TurnItem, i: number) => {
    const meta = blockMeta[blockKey(it)] ?? {};
    return (
      <div key={i} className="flex flex-col gap-1">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          <span>
            <span
              className={`mr-1.5 normal-case ${
                it.role === "user" ? "text-blue-500" : "text-orange-500"
              }`}
            >
              ●
            </span>
            {it.role === "user" ? "you" : "claude"}
            {it.at && (
              <span className="ml-2 normal-case tracking-normal text-zinc-600">
                {new Date(it.at).toLocaleTimeString()}
              </span>
            )}
          </span>
          {meta.favorite && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-label="favorited"
              className="shrink-0 text-yellow-300"
            >
              <path d="M12 2l2.9 6.3 6.8.8-5 4.6 1.3 6.7L12 17.8 5.7 21l1.3-6.7-5-4.6 6.8-.8z" />
            </svg>
          )}
        </div>
        {meta.hidden ? (
          <button
            type="button"
            onClick={() => toggleBlockHidden(it)}
            className="flex w-full items-center gap-2 rounded-md border border-dashed border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-left font-mono text-[11px] text-zinc-600 transition-colors hover:text-zinc-300"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <path d="m2 2 20 20" />
            </svg>
            hidden block · <span className="text-zinc-400 underline">show</span>
          </button>
        ) : (
          <div
            data-role={it.role}
            className={`group/turn relative break-words rounded-md border p-3 font-mono text-xs leading-relaxed ${
              savedNotes.has(it.text)
                ? it.role === "user"
                  ? "whitespace-pre-wrap border-blue-500/70 bg-zinc-900 text-zinc-100"
                  : "border-blue-500/70 bg-zinc-900/40 text-zinc-300"
                : it.role === "user"
                  ? "whitespace-pre-wrap border-zinc-700 bg-zinc-900 text-zinc-100"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-300"
            }`}
          >
            <BlockMenu
              saved={savedNotes.has(it.text)}
              favorite={!!meta.favorite}
              hidden={!!meta.hidden}
              reaction={meta.reaction ?? null}
              showReactions={it.role === "assistant"}
              onCopy={() => navigator.clipboard.writeText(it.text)}
              onFavorite={() => toggleBlockFavorite(it)}
              onSaveNote={() => saveNoteBlock(it)}
              onSaveCode={() => saveCodeBlock(it)}
              onReact={(r) => reactToBlock(it, r)}
              onHide={() => toggleBlockHidden(it)}
            />
            {it.role === "assistant" ? <Markdown text={it.text} /> : it.text}
            {it.role === "assistant" && it.turnTokens ? (
              <span
                title="output tokens this whole work block burned (every API call from your prompt to this reply)"
                className="absolute -bottom-[9px] right-3 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-px font-mono text-[10px] text-zinc-500"
              >
                block · {fmtTokens(it.turnTokens)} tok
              </span>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  // One tool step (Bash / Edit / Write / Read …) — the same ⋮ menu as a turn,
  // inline on the <details> summary row. Hidden → a "hidden step · show" stub.
  const renderTool = (it: ToolItem, i: number) => {
    const meta = blockMeta[it.id] ?? {};
    if (meta.hidden) {
      return (
        <button
          key={i}
          type="button"
          onClick={() => toggleToolHidden(it)}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-zinc-800 bg-zinc-900/30 px-3 py-1.5 text-left font-mono text-[11px] text-zinc-600 transition-colors hover:text-zinc-300"
        >
          <span className="text-zinc-600">{it.tool}</span>
          hidden step · <span className="text-zinc-400 underline">show</span>
        </button>
      );
    }
    return (
      <details
        key={i}
        className="group group/turn relative rounded-md border border-zinc-800 bg-zinc-900/30"
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 font-mono text-xs marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="text-zinc-600 transition-transform group-open:rotate-90">›</span>
          <span
            className={`shrink-0 text-[10px] uppercase tracking-wide ${
              it.isError ? "text-red-400" : "text-zinc-500"
            }`}
          >
            {it.tool}
          </span>
          <span className="min-w-0 flex-1 truncate text-zinc-300">{it.title}</span>
          {meta.favorite && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-label="favorited"
              className="shrink-0 text-yellow-300"
            >
              <path d="M12 2l2.9 6.3 6.8.8-5 4.6 1.3 6.7L12 17.8 5.7 21l1.3-6.7-5-4.6 6.8-.8z" />
            </svg>
          )}
          {(it.resultTokens ?? 0) >= 1000 && (
            <span
              className={`shrink-0 text-[10px] ${
                (it.resultTokens ?? 0) >= 12000
                  ? "text-red-400"
                  : (it.resultTokens ?? 0) >= 4000
                    ? "text-amber-400"
                    : "text-zinc-600"
              }`}
              title="rough context cost of this step (input + result, ~4 chars/token)"
            >
              ~{fmtTokens(it.resultTokens ?? 0)} tok
            </span>
          )}
          <BlockMenu
            saved={savedNotes.has(it.detail)}
            favorite={!!meta.favorite}
            hidden={!!meta.hidden}
            reaction={null}
            showReactions={false}
            triggerClass="shrink-0"
            revealClass="opacity-0 group-hover:opacity-100"
            onCopy={() => navigator.clipboard.writeText(it.detail)}
            onFavorite={() => toggleToolFavorite(it)}
            onSaveNote={() =>
              saveNoteBlock({ text: `${it.tool} · ${it.title}\n\n${it.detail}`, role: "assistant", at: it.at })
            }
            onSaveCode={() => saveCodeBlock({ text: it.detail, role: "assistant", at: it.at })}
            onReact={() => {}}
            onHide={() => toggleToolHidden(it)}
          />
        </summary>
        <pre className="scrollbar-none max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-zinc-800 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
          {it.detail}
        </pre>
      </details>
    );
  };

  // Auto-grow the send box from 1 line up to ~8, then scroll — mirrors the CLI
  // input. Runs on every draft change (incl. the post-send clear → shrinks back).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    // grow with content up to ~8 lines, then scroll (it's bottom-anchored, so it
    // grows upward into the message area)
    ta.style.height = `${Math.min(ta.scrollHeight, 176)}px`;
  }, [draft]);

  // The send goes to the session ON SCREEN — its id is snapshotted here, at
  // send time, so "newest" can't silently re-aim it between typing and sending
  // (the 001.8 roulette). The guard lives in the plumbing, not the UI: the API
  // refuses anonymous sends, this never sends one.
  // Compress pasted/dropped/picked images and stage them. Capped at ATTACH_LIMIT
  // so a stray multi-file drop can't balloon the send.
  async function addFiles(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    try {
      const next = await Promise.all(imgs.map((f) => compressImage(f, f.name)));
      setAttachments((a) => [...a, ...next].slice(0, ATTACH_LIMIT));
    } catch {
      setError("couldn't read that image");
    }
  }

  async function doSend() {
    if (staged) {
      // New-session view: Enter / the send arrow STARTS the session — in the selected
      // target (a chip or a to-be-created project), or ~/hq when nothing is selected
      // (never the bare home dir). The typed draft is turn one. Nothing launches on a
      // chip click; this send is the only launch path.
      const first = draft.trim();
      if (!first && attachments.length === 0) return; // launch ALWAYS requires a message — a selected project alone never starts
      const target = selectedTarget?.cwd
        ? { cwd: selectedTarget.cwd, label: selectedTarget.name }
        : selectedTarget?.newProject
          ? { newProject: selectedTarget.newProject, label: selectedTarget.name }
          : undefined; // ~/hq default
      setSelectedTarget(null);
      await birthAndDrive(target, first);
      return;
    }
    // Locked: this session is working in its own terminal — sending would --resume a
    // second process and interleave. The box is disabled; this guards the Enter path.
    if (locked) return;
    // CHANNEL-IN: a channel-connected session is driven by PUSH (no fork). Append the
    // optimistic user turn, POST /api/channel, and let the EXISTING transcript poll +
    // SSE render the reply — channel pushes PERSIST to the .jsonl as normal turns, so
    // the observe path picks them up. NO setLive(true) (that would spawn a SECOND warm
    // REPL = the fork we are avoiding), NO repl.send, NO `sending` (no warm process →
    // no repl.busy edge to clear it → no stop button); the in-flight signal is the
    // poll's `working` status + the optimistic turn. Images ride along EXACTLY like
    // the driven path: posted as base64 to /api/channel, which writes them to
    // ~/.claude/hq-pastes and pushes `@<path>` mentions so Claude reads them as vision.
    if (channelConnected) {
      const target = pinned ?? resolvedId;
      const prompt = draft.trim();
      const imgs = attachments;
      if (!target || (!prompt && imgs.length === 0)) return;
      const optimistic = [
        prompt,
        imgs.length ? `📎 ${imgs.length} image${imgs.length > 1 ? "s" : ""} attached` : "",
      ].filter(Boolean).join("\n\n");
      setItems((t) => [
        ...t,
        { kind: "turn", role: "user", text: optimistic, at: new Date().toISOString() },
      ]);
      setDraft("");
      setAttachments([]);
      setError(null);
      busyRef.current = true; // protect the optimistic turn through the 1s working-tick poll
      const res = await fetch("/api/channel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session: target,
          content: prompt,
          source: "hq",
          images: imgs.map(({ data, mime }) => ({ data, mime })),
        }),
      }).catch(() => null);
      busyRef.current = false; // free the next observe poll to commit the channel reply
      if (!res || !res.ok) setError("channel closed — reopen the session with claude-hq and try again");
      return;
    }
    // ALWAYS route through the warm live REPL — no driveMode gate, no one-shot
    // `-p` dead-end. The send streams back over SSE and lands via the transcript
    // poll like any turn. `live` is flipped HERE (synchronously) so the SSE
    // effect opens BEFORE/with the send — buffer-replay (lib/repl subscribe)
    // catches the connect gap so a permission ask is never silently swallowed.
    // Same id the REPL hook is keyed to (`replTarget`), so the optimistic turn,
    // sendTargetRef, drivenSessionRef, the guard, and `repl.send`'s captured
    // sessionId are provably this render's value — no stale-resolvedId split.
    const target = replTarget;
    const prompt = draft.trim();
    const imgs = attachments; // snapshot — survives the clear below
    if (!target || sending || (!prompt && imgs.length === 0)) return;
    // WARN-BEFORE-FORK: reaching here with `!live` means a brand-new warm REPL is
    // about to --resume this session = a fork (staged/locked/channel cases already
    // returned above). Gate that FIRST send behind an explicit confirm, once per
    // session. The draft is left untouched so confirm just re-sends it.
    if (!live && !forkAckRef.current.has(target)) {
      setForkWarn(target);
      return;
    }
    sendTargetRef.current = target;
    stoppedRef.current = false;
    setError(null);
    const optimistic = [
      prompt,
      imgs.length ? `📎 ${imgs.length} image${imgs.length > 1 ? "s" : ""} attached` : "",
    ].filter(Boolean).join("\n\n");
    setItems((t) => [
      ...t,
      { kind: "turn", role: "user", text: optimistic, at: new Date().toISOString() },
    ]);
    setDraft("");
    setAttachments([]);
    drivenSessionRef.current = target; // bind `live` to THIS session (auto-clear tracks it)
    setLive(true); // open the SSE + render the live overlay (permission cards)
    // setSending/busyRef are the IMMEDIATE optimistic in-flight flags: `sending`
    // morphs the send→stop button (repl.busy lags the SSE round-trip) and drives
    // the flash; `busyRef` guards the optimistic turn from the 1s poll clobbering
    // it mid-stream. Both clear on repl.busy's true→false edge (effect below).
    setSending(true);
    busyRef.current = true;
    // First send honors the model picker (spawn-time --model); a mid-session
    // model change needs a process restart and is out of scope — see risks.
    const sent = await repl.send(
      prompt,
      imgs.map(({ data, mime }) => ({ data, mime })),
      chosenModel ?? undefined,
    );
    // If the send never landed (network/route failure, or sendTurn returned
    // {ok:false}), no SSE event will rise/lower `busy`, so the repl.busy edge
    // effect can't clear the optimistic flags. Clear them HERE and surface the
    // error — otherwise the next poll silently replaces the optimistic turn with
    // server truth (which lacks this message) and it vanishes with no trace.
    if (!sent || sent.ok === false) {
      setSending(false);
      busyRef.current = false;
      setLive(false);
      drivenSessionRef.current = null;
      setError("couldn't send — the live session may have closed; try again");
    }
  }

  // Acknowledge the fork warning and proceed: remember this session so we never
  // re-warn it, then re-enter doSend — which now sails past the gate and forks.
  function confirmFork() {
    if (forkWarn) forkAckRef.current.add(forkWarn);
    setForkWarn(null);
    doSend();
  }

  // New-session-from-HQ: birth a fresh `claude` in the project dir via the REPL
  // backend, then pin + drive it — no TUI, no copy-paste. The route returns the
  // real session id once the process inits; we navigate the pane to it (drive on).
  async function birthAndDrive(
    target?: { cwd?: string; newProject?: string; label?: string },
    firstPrompt?: string
  ) {
    if (starting) return;
    const label = target?.label ?? target?.newProject ?? "here";
    setStarting(label);
    setError(null);
    try {
      const res = await fetch("/api/terminal/repl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "new",
          cwd: target?.cwd,
          newProject: target?.newProject,
          model: chosenModel ?? undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || `error ${res.status}`);
      const data = await res.json();
      if (data?.sessionId) {
        drivenSessionRef.current = data.sessionId; // bind `live` to the newborn (survives the navigate)
        setLive(true);
        // A first message typed in the send box rides straight into the newborn
        // (ensureRepl by id is idempotent — finds this exact warm process).
        const first = (firstPrompt ?? "").trim();
        if (first) {
          setItems((t) => [
            ...t,
            { kind: "turn", role: "user", text: first, at: new Date().toISOString() },
          ]);
          setDraft("");
          await fetch("/api/terminal/repl", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "send", session: data.sessionId, text: first }),
          });
        }
        router.push(hrefFor(data.sessionId), { scroll: false });
      } else {
        throw new Error("no session id returned");
      }
    } catch (e) {
      setError(`couldn't start a session${label !== "here" ? ` in ${label}` : ""}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStarting(null);
    }
  }

  // Release HQ's warm process — "hand the wheel back to your TUI". Drops the
  // CLI-style interrupt marker into the timeline, then stops the REPL (SIGTERM
  // the warm child); the NEXT send re-resumes from the on-disk transcript (cold
  // start). This is now "release the live process", not "abort just this run" —
  // there's no mid-turn abort-but-keep-warm primitive (see risks). Also clears
  // the optimistic in-flight flags since repl.busy may never have risen.
  async function stopSend() {
    const target = sendTargetRef.current;
    if (!target) return;
    stoppedRef.current = true;
    setItems((t) => [
      ...t,
      {
        kind: "turn",
        role: "user",
        text: "[Request interrupted by user]",
        at: new Date().toISOString(),
      },
    ]);
    setSending(false);
    busyRef.current = false;
    try {
      await repl.stop(); // {action:'stop'} → stopRepl (releases the warm process)
      setLive(false);
      drivenSessionRef.current = null;
    } catch {
      // best-effort — the next send re-resumes from disk
    }
  }
  // CODE-REVIEW FE-5: keep the once-bound Esc handler pointed at the latest
  // stopSend (it closes over no per-render state, but sync anyway for safety).
  stopSendRef.current = stopSend;

  const elapsed = status
    ? Math.max(0, Math.floor((now - status.startedAt) / 1000))
    : 0;
  const mood = MOODS[Math.floor(elapsed / 8) % MOODS.length];
  const cacheLeft =
    !working && lastWrite !== null && now > 0
      ? CACHE_TTL_MS - (now - lastWrite)
      : null;
  const ctxPct = (contextTokens / CONTEXT_LIMIT) * 100;
  // % of the 1M window still free — mirrors the CLI's own "ctx NN%" readout
  // (which counts down as the session fills), not the raw token count.
  const ctxLeftPct = Math.max(0, Math.round(100 - ctxPct));
  const cliffPct = (PRICING_CLIFF / CONTEXT_LIMIT) * 100; // 200k tick on the bar
  const cacheWarm = cacheLeft !== null && cacheLeft > 0;

  // Centered "conversation shell" (claude.ai shape). `centered` is auto-on when
  // this terminal isn't bound to a live session — the deploy / empty state
  // (notConnected) — and toggleable for a LIVE local session via the header
  // `focus` chip. One flag, two consumers: the not-connected onboarding and
  // focus mode render through the exact SAME layout. When off, the scroll + dock
  // wrappers collapse to `display:contents`, so the full-width transcript is
  // byte-for-byte unchanged.
  // Driving a freshly-birthed session has no transcript yet — but HQ owns a live
  // process, so it's NOT "not connected": show the chat + a usable send box.
  const notConnected =
    !staged &&
    !live &&
    !channelConnected && // a live channel session with no transcript yet is READY, not "blank" — show a typeable terminal, not the install demo
    (previewInstall || (!loading && items.length === 0));
  const centered = notConnected || focusMode;
  const colWrap = centered
    ? "mx-auto flex w-full max-w-3xl flex-col gap-4 px-4"
    : "contents";
  // The send (↑) button is live only when there's something to send to a real
  // session; while a run is in flight it morphs into the red stop button.
  const canSend =
    (draft.trim() !== "" || attachments.length > 0) &&
    (staged || !notConnected) &&
    !locked;

  // The cache meter — top-right in the header (and the footer in the centered
  // shell). ctx moved out to sit beside the session id (ctxMeter, below).
  const meter = (
    <>
      {cacheLeft !== null && cacheLeft > 0 && (
        <span
          className="font-mono text-[11px] text-amber-400"
          title="prompt cache is warm — replying now reads history at ~10% price"
        >
          cache {Math.floor(cacheLeft / 60000)}:
          {String(Math.floor((cacheLeft % 60000) / 1000)).padStart(2, "0")}
        </span>
      )}
      {coldFlash !== "off" && (
        <span
          className={`font-mono text-[11px] text-blue-400 transition-opacity duration-[1500ms] ease-out ${
            coldFlash === "out" ? "opacity-0" : "opacity-100"
          }`}
          title="prompt cache expired — the next message re-reads the full history"
        >
          cold
        </span>
      )}
    </>
  );

  // ctx % — a fuel gauge by % of the 1M window LEFT: hidden until it drops to
  // 50%, then green (50–26) → amber (25–11) → red (≤10) → red-blink (≤5). Sits
  // just LEFT of the cache meter (dock when wide, footer when focused). The bar
  // still appears past 75% used.
  const ctxColor =
    ctxLeftPct <= 10
      ? "text-red-400"
      : ctxLeftPct <= 25
        ? "text-amber-400"
        : "text-green-400";
  const ctxMeter = contextTokens > 0 && ctxLeftPct <= 50 && (
    <span className="flex shrink-0 items-center gap-1.5">
      <span
        className={`font-mono text-[11px] ${ctxColor} ${
          ctxLeftPct <= 5 ? "animate-pulse" : ""
        }`}
        title={`~${ctxLeftPct}% of your 1M window left — ${fmtTokens(contextTokens)} of ${fmtTokens(CONTEXT_LIMIT)} used (mirrors the CLI's ctx %)`}
      >
        ctx {ctxLeftPct}%
      </span>
      {ctxPct >= 75 && (
        <span
          className="relative h-1 w-14 overflow-hidden rounded-full bg-zinc-800"
          title={`context ~${fmtTokens(contextTokens)} of ${fmtTokens(CONTEXT_LIMIT)} · the tick at ${fmtTokens(PRICING_CLIFF)} is the long-context pricing cliff (~2× input)`}
        >
          <span
            className={`absolute inset-y-0 left-0 ${
              ctxPct >= 80 ? "bg-red-500" : "bg-amber-500"
            }`}
            style={{ width: `${Math.min(100, ctxPct)}%` }}
          />
          <span
            className="absolute inset-y-0 w-px bg-amber-400/60"
            style={{ left: `${cliffPct}%` }}
          />
        </span>
      )}
    </span>
  );

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 flex-col gap-3"
      // The whole pane is the catch basin: drop a screenshot anywhere in THIS
      // terminal and it attaches to THIS send box; drop a To Do card and its text
      // fills the message box as a prompt. Terminal 1 and Terminal 2 are separate
      // instances → separate basins, no cross-talk. Mirrors the native CLI's
      // "drop anywhere on the window."
      onDragEnter={(e) => {
        const kind = staged ? null : dragKind(e.dataTransfer);
        if (!kind) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(kind);
      }}
      onDragOver={(e) => {
        if (staged || !dragKind(e.dataTransfer)) return;
        e.preventDefault(); // required for onDrop to fire
      }}
      onDragLeave={(e) => {
        if (staged || !dragKind(e.dataTransfer)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragOver(null);
        }
      }}
      onDrop={(e) => {
        const kind = staged ? null : dragKind(e.dataTransfer);
        if (!kind) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(null);
        if (kind === "file") {
          addFiles(Array.from(e.dataTransfer.files));
        } else {
          const text =
            e.dataTransfer.getData(TODO_DND_TYPE) ||
            e.dataTransfer.getData("text/plain");
          if (text)
            setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, "")}\n${text}` : text));
        }
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-sky-500 bg-zinc-950/70">
          <span className="rounded-md bg-sky-500/15 px-3 py-1.5 font-mono text-xs text-sky-300">
            {dragOver === "todo"
              ? "Drop to add to your message"
              : "Drop screenshot to attach"}
          </span>
        </div>
      )}
      {/* mb-1.5 — Brendan's 6px of air between the header and the stream */}
      <div className="mb-2 border-b border-zinc-800 pb-3">
        {/* The whole header row — session metadata (dot · project · id · search ·
            lineage) AND the layout toggle — rides the SAME centered column as the
            message stream when FOCUSED (the colWrap: mx-auto max-w-3xl px-4), so
            they all move together; full-width left in WIDE screen. */}
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${
            centered ? "mx-auto w-full max-w-3xl px-4" : ""
          }`}
        >
        <span className="flex items-center gap-1.5 text-xs">
          {/* Activity dot, same vocabulary as the session cards: blinking =
              writing right now, solid = active within the cache window (5 min),
              muted = idle. Pin state lives in the send switch, not here. */}
          <span
            title={
              working
                ? "writing right now"
                : cacheWarm
                  ? "active — within the cache window"
                  : "idle — no recent activity"
            }
            className={`size-2 rounded-full ${
              working
                ? "animate-pulse bg-green-500"
                : cacheWarm
                  ? "bg-green-500"
                  : "bg-green-500/30"
            }`}
          />
          <span className="font-mono text-zinc-300">
            {staged ? "new session" : project || "session"}
          </span>
        </span>
        {resolvedId ? (
          <button
            onClick={() => {
              navigator.clipboard.writeText(resolvedId);
              setIdCopied(true);
              setTimeout(() => setIdCopied(false), 1200);
            }}
            title={
              idCopied ? "copied" : `copy session id · ${resolvedId.slice(0, 8)}`
            }
            className={`cursor-pointer rounded px-1 py-0.5 font-mono text-[11px] transition-colors ${
              idCopied
                ? "bg-emerald-500/15 text-emerald-300"
                : "text-green-400 hover:text-green-300"
            }`}
          >
            {customTitle || resolvedId.slice(0, 8)}
          </button>
        ) : (
          <span className="font-mono text-[11px] text-zinc-600">—</span>
        )}
        {/* Panels menu — the layout-grid icon opens Activity/Metrics/Console/
            Compose/Planner/Text. Lives here in the header (per-session search now
            lives only in the send box). */}
        <PanelMenu />
        {/* The /clear chain: this session's tied line of continuations.
            Click a row to show that session in the terminal. */}
        {lineage?.chain && (
          <details
            ref={lineageRef}
            className="relative shrink-0"
            // Navbar-style: open on hover, close on leave — same as PanelMenu.
            onMouseEnter={() => { if (lineageRef.current) lineageRef.current.open = true; }}
            onMouseLeave={() => { if (lineageRef.current) lineageRef.current.open = false; }}
          >
            <summary
              title={`session tree — ${lineage.chain.length} tied by /clear continuations`}
              // Bare folder-tree icon button (send-box standard); the dropdown
              // lists the chain. Replaced the "sessions · N" text label.
              className="flex shrink-0 cursor-pointer list-none items-center rounded-md p-1.5 text-zinc-400 transition-colors marker:content-none [&::-webkit-details-marker]:hidden hover:bg-zinc-800 hover:text-zinc-200"
            >
              {/* lucide folder-tree */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M20 10a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 14 7h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1Z" />
                <path d="M20 21a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2a1 1 0 0 0-.8-.4H12a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1Z" />
                <path d="M3 5a2 2 0 0 0 2 2h3" />
                <path d="M3 3v13a2 2 0 0 0 2 2h3" />
              </svg>
            </summary>
            {/* pt-1.5 is a TRANSPARENT hover-bridge — a descendant of <details>, so
                the pointer can cross icon→menu without firing mouseleave. */}
            <div className="absolute left-0 top-full z-20 pt-1.5">
            <div className="relative flex w-72 flex-col rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-1 shadow-xl">
              {/* info-circle chip straddling the dashed top border — same pattern
                  as PanelMenu's "about panels" chip. */}
              <div className="absolute -top-2.5 right-2 z-10">
                <ButtonChipIcon
                  onClick={() => {}}
                  label="About the session tree"
                  title="A continuous terminal session, differentiated by the /clear function and individual session IDs."
                  icon={
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4" />
                      <path d="M12 8h.01" />
                    </svg>
                  }
                />
              </div>
              {lineage.chain.map((c, i) => (
                <Link
                  key={c.id}
                  href={hrefFor(c.id)}
                  scroll={false}
                  onClick={() => { if (lineageRef.current) lineageRef.current.open = false; }}
                  className={`flex items-baseline gap-2 rounded px-2 py-1 font-mono text-[11px] transition-colors hover:bg-zinc-900 ${
                    c.id === resolvedId ? "text-zinc-200" : "text-zinc-500"
                  }`}
                >
                  <span className="shrink-0 text-zinc-600">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {c.title || c.id.slice(0, 8)}
                  </span>
                  <span className="shrink-0 text-[10px] text-zinc-600">
                    {c.id === resolvedId
                      ? "in terminal"
                      : i > 0
                        ? `cleared in ${new Date(c.bornAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                        : `started ${new Date(c.bornAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                  </span>
                </Link>
              ))}
            </div>
            </div>
          </details>
        )}
        {/* "live in HQ" — shown ONLY while HQ owns this session's process (you drove
            it / +new). No lock badge: the one fork-risk state — a non-channel-aware
            session working in its own terminal — is signalled by the SEND BOX itself
            (it disables + shows the lock placeholder). ml-auto pushes the right
            cluster; when not live the focus toggle below carries ml-auto instead. */}
        {live && resolvedId && !notConnected && (
          <button
            type="button"
            onClick={() =>
              setLive(() => {
                repl.stop();
                drivenSessionRef.current = null;
                return false;
              })
            }
            title="live in HQ — HQ owns this session's process. Click to release so the terminal can take over."
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-1.5 py-px font-mono text-[10px] text-emerald-300 transition-colors"
          >
            <span
              className={`size-1.5 rounded-full ${
                repl.busy ? "animate-pulse bg-emerald-400" : "bg-emerald-400"
              }`}
            />
            live in HQ
          </button>
        )}
        {/* Resume in terminal — hand the wheel back to the TUI. Copies
            `claude --resume <id>` AND stops HQ's warm process (the route's stop
            action records the to-terminal handoff divider). Stopping is MANDATORY,
            not optional: one active writer at a time (lib/repl.ts) — handing the
            TUI the wheel while HQ still drives is the interleave-corruption the
            whole design forbids. So Resume = stop + copy, and it flips `live` off
            to match the pill-release path. Only while live + a real pinned session. */}
        {live && resolvedId && !notConnected && paramKey === "session" && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(`claude --resume ${resolvedId}`);
              repl.stop(); // POSTs stop → records to-terminal
              setLive(false);
              drivenSessionRef.current = null;
            }}
            title="copy `claude --resume <id>` and release HQ's process so the TUI can take over"
            className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-1.5 py-px font-mono text-[10px] text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-300"
          >
            resume in terminal
          </button>
        )}
        {/* Layout toggle — flips this live session between two real modes: "focus
            mode" (the centered conversation shell, the DEFAULT) and "wide screen".
            The choice persists in the hq-focus cookie (read server-side in
            shell.tsx → no flash), shared across both panes like the sidebar.
            Part of the header cluster, so it rides the centered column WITH the
            metadata when focused. minimize-2 while wide (shrink into focus),
            maximize-2 while focused. Pinned session only. */}
        {(resolvedId || staged) && !notConnected && (
          <Tooltip
            label={focusMode ? "Wide screen" : "Focus mode"}
            placement="bottom"
            className={live ? undefined : "ml-auto"}
          >
          <button
            type="button"
            onClick={() =>
              setFocusMode((f) => {
                const next = !f;
                document.cookie = `hq-focus=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
                return next;
              })
            }
            aria-label={focusMode ? "Wide screen" : "Focus mode"}
            className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
              {focusMode ? (
                // lucide maximize-2 — expand back out to wide screen
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" x2="14" y1="3" y2="10" />
                  <line x1="3" x2="10" y1="21" y2="14" />
                </svg>
              ) : (
                // lucide minimize-2 — shrink into the centered focus mode
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" x2="21" y1="10" y2="3" />
                  <line x1="3" x2="10" y1="21" y2="14" />
                </svg>
              )}
            </button>
          </Tooltip>
          )}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          atBottomRef.current = atBottom;
          if (atBottom) suppressJumpRef.current = false; // the glide landed
          setShowJump(!atBottom && !suppressJumpRef.current);
          if (el.scrollTop < 120) loadOlder();
        }}
        className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
        // Top-edge fade — masks the top ~64px of the scroll viewport to
        // transparent so streaming text dissolves into the bg as it slides up
        // under the header (instead of a hard cut). Inline so it can't be purged
        // or overridden by Tailwind's own mask layer; webkit-prefixed for Chromium.
        style={{
          WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 64px)",
          maskImage: "linear-gradient(to bottom, transparent, #000 64px)",
        }}
      >
        {/* Centered column when `centered`; `display:contents` (a no-op) when not,
            so the full-width transcript is unchanged. */}
        <div className={colWrap}>
        {/* The "+" staging view: nothing exists yet — say how a session is
            born, offer the recent list, and auto-flip when one appears. No
            handoff kickoff here: that belongs to /clear-born continuations. */}
        {staged && (
          // Top-aligned, full-width (matches the header rule above). Two ruled
          // sections — PROJECTS (pick a launch target) then SESSIONS (reopen one).
          <div className="flex w-full flex-col gap-6 pb-8 pt-2 font-mono">
            {/* PROJECTS — click to SELECT a launch target (the session starts only on
                send, never on a stray click). An even grid, clamped to 2 rows; the
                chevron reveals the rest. */}
            <div className="flex flex-col gap-3">
              <div
                ref={projGridRef}
                className={`grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 ${
                  projExpanded ? "" : "max-h-[80px] overflow-hidden"
                }`}
              >
                {projects.map((p) => {
                  const sel = selectedTarget?.cwd === p.path;
                  return (
                    <button
                      key={p.path}
                      type="button"
                      disabled={!!starting}
                      onClick={() => setSelectedTarget(sel ? null : { name: p.name, cwd: p.path })}
                      title={`launch a session in ${p.path}`}
                      className={`flex h-9 items-center rounded-md border px-2 transition-colors disabled:opacity-50 ${
                        sel
                          ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20"
                          : "border-zinc-800 text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300"
                      }`}
                    >
                      <span className="w-full truncate text-center text-[11px]">{p.name}</span>
                    </button>
                  );
                })}
              </div>
              {/* control row — the expand/collapse chevron (left) + "+ new" (right) */}
              <div className="flex items-center gap-2">
                {(projOverflow || projExpanded) && (
                  <button
                    type="button"
                    onClick={() => setProjExpanded((v) => !v)}
                    title={projExpanded ? "show fewer projects" : "show all projects"}
                    className="flex h-9 items-center gap-1 rounded-md px-2 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    {projExpanded ? "less" : "more"}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`transition-transform ${projExpanded ? "rotate-180" : ""}`}
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                )}
                {newOpen ? (
                  <input
                    autoFocus
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      const name = newProjectName.trim();
                      if (e.key === "Enter" && name) {
                        e.preventDefault();
                        setSelectedTarget({ name, newProject: name });
                        setNewProjectName("");
                        setNewOpen(false);
                      } else if (e.key === "Escape") {
                        setNewOpen(false);
                        setNewProjectName("");
                      }
                    }}
                    onBlur={() => {
                      const name = newProjectName.trim();
                      if (name) setSelectedTarget({ name, newProject: name });
                      setNewOpen(false);
                      setNewProjectName("");
                    }}
                    disabled={!!starting}
                    placeholder="project name… ↵"
                    className="ml-auto h-9 w-44 rounded-md border border-dashed border-emerald-500/50 bg-transparent px-3 text-[11px] text-emerald-200 placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
                  />
                ) : (
                  <button
                    type="button"
                    disabled={!!starting}
                    onClick={() => setNewOpen(true)}
                    title="name a new project (the folder is created when you send)"
                    className="ml-auto flex h-9 items-center rounded-md border border-dashed border-zinc-700 px-3 text-[11px] text-zinc-500 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-50"
                  >
                    + new
                  </button>
                )}
              </div>
            </div>

            {/* SESSIONS — its own ruled section (header + border live in the component) */}
            {resume && <RecentSessions sessions={resume.sessions} now={now} />}
          </div>
        )}
        {!staged && !previewInstall && loading && items.length === 0 && (
          <p className="text-sm text-zinc-600">loading session…</p>
        )}
        {notConnected && <OnboardingConversation />}
        {!previewInstall && items.map((it, i) =>
          it.kind === "handoff" ? (
            // HQ↔terminal control-transfer divider — cloned from the /clear
            // command divider below. Emerald when HQ takes the wheel (matches the
            // live pill + overlay), zinc when the TUI takes it back, so the eye
            // reads "green = HQ has it".
            <div
              key={i}
              className={`flex items-center gap-2 font-mono text-[11px] ${
                it.direction === "to-hq" ? "text-emerald-400" : "text-zinc-500"
              }`}
            >
              <span
                className={`h-px w-6 shrink-0 ${
                  it.direction === "to-hq" ? "bg-emerald-500/40" : "bg-zinc-800"
                }`}
              />
              <span className="shrink-0">
                {it.direction === "to-hq"
                  ? "▸ HQ is now driving this session"
                  : "◂ resumed in terminal"}
                {it.at && ` · ${new Date(it.at).toLocaleTimeString()}`}
              </span>
              <span
                className={`h-px min-w-6 flex-1 ${
                  it.direction === "to-hq" ? "bg-emerald-500/40" : "bg-zinc-800"
                }`}
              />
            </div>
          ) : it.kind === "command" ? (
            <div
              key={i}
              className="flex items-center gap-2 font-mono text-[11px] text-zinc-600"
            >
              <span className="h-px w-6 shrink-0 bg-zinc-800" />
              <span className="shrink-0">
                {it.command}
                {it.arg ? ` ${it.arg}` : ""}
                {it.command === "/clear" && " · context reset"}
              </span>
              {it.at && (
                <span className="shrink-0">
                  · {new Date(it.at).toLocaleTimeString()}
                </span>
              )}
              <span className="h-px min-w-6 flex-1 bg-zinc-800" />
            </div>
          ) : it.kind === "status" ? (
            // A background agent came to rest — the quiet inline marker that
            // mirrors the TUI, instead of the raw <task-notification> dump
            // masquerading as a user turn.
            <div
              key={i}
              className="flex items-center gap-2 font-mono text-[11px] text-zinc-500"
            >
              <span className="h-px w-6 shrink-0 bg-zinc-800" />
              <span className="shrink-0">
                <span className="mr-1 text-zinc-600">⟲</span>
                {it.text}
              </span>
              <span className="h-px min-w-6 flex-1 bg-zinc-800" />
            </div>
          ) : it.kind === "turn" ? (
            renderTurn(it, i)
          ) : (
            renderTool(it, i)
          )
        )}
        {/* Live REPL overlay (while `live`): the in-flight assistant turn
            streaming token-by-token, the current turn's tool calls, and any
            pending permission asks as Approve/Deny cards. CRITICAL: gated on
            `live` (true on every routed send) so a tool that needs approval is
            never silently swallowed. Completed turns still land via the
            transcript poll above; this is the instant layer on top. */}
        {live &&
          (repl.liveText || repl.liveTools.length > 0 || repl.permissions.length > 0) && (
            <div className="flex flex-col gap-2">
              {(repl.liveText || repl.liveTools.length > 0) && (
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    <span className="mr-1.5 normal-case text-emerald-400">●</span>
                    claude · live
                  </span>
                  <div className="break-words rounded-md border border-emerald-500/30 bg-zinc-900/40 p-3 font-mono text-xs leading-relaxed text-zinc-300">
                    {repl.liveText ? <Markdown text={repl.liveText} /> : null}
                    {repl.liveTools.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {repl.liveTools.map((tl) => (
                          <span
                            key={tl.id}
                            className="rounded border border-zinc-700 px-1.5 py-px font-mono text-[10px] text-zinc-400"
                          >
                            {tl.name}…
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {repl.permissions.map((p) => (
                <div
                  key={p.toolUseId}
                  className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3"
                >
                  <p className="font-mono text-xs text-amber-200">
                    <span className="mr-1.5">⚠</span>approve{" "}
                    <span className="font-semibold">{p.toolName}</span>?
                  </p>
                  <pre className="scrollbar-slim max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-400">
                    {JSON.stringify(p.input, null, 2)}
                  </pre>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => repl.answer(p.toolUseId, { behavior: "allow" })}
                      className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] text-emerald-300 transition-colors hover:bg-emerald-500/20"
                    >
                      approve
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        repl.answer(p.toolUseId, { behavior: "deny", message: "denied from HQ" })
                      }
                      className="rounded-md border border-red-500/50 bg-red-500/10 px-2.5 py-1 font-mono text-[11px] text-red-300 transition-colors hover:bg-red-500/20"
                    >
                      deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        {/* End-of-the-line marker: this session was wrapped and continued
            elsewhere — the answer to "that was the end of 2aa29e46, where did
            it go?". Click follows the continuation. */}
        {!loading && lineage?.successor && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-600">
            <span className="h-px w-6 shrink-0 bg-zinc-800" />
            <Link
              href={hrefFor(lineage.successor.id)}
              scroll={false}
              className="shrink-0 transition-colors hover:text-zinc-300"
              title="open the session that continues this one"
            >
              → continued by {lineage.successor.project} ·{" "}
              {lineage.successor.id.slice(0, 8)} ·{" "}
              {new Date(lineage.successor.bornAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Link>
            <span className="h-px min-w-6 flex-1 bg-zinc-800" />
          </div>
        )}
        {!loading && items.length > 0 && items.every((it) => it.kind === "command") && (
          <div className="flex flex-col gap-3 font-mono text-xs">
            {/* /clear-born: say plainly which session's work continues here. */}
            {lineage?.predecessor && (
              <p className="text-zinc-400">
                <Link
                  href={hrefFor(lineage.predecessor.id)}
                  scroll={false}
                  className="text-zinc-300 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-100"
                  title="open the cleared session read-only"
                >
                  {lineage.predecessor.project} ·{" "}
                  {lineage.predecessor.id.slice(0, 8)}
                </Link>{" "}
                was cleared — its work continues here
                {predecessorCtx > 0 && (
                  <span className="text-zinc-600">
                    {" "}
                    · it ended at ctx {fmtTokens(predecessorCtx)}
                  </span>
                )}
              </p>
            )}
            <div className="flex flex-col gap-1">
              <p className="text-zinc-400">fresh session — no turns yet</p>
              <p className="text-zinc-600">
                type in your Claude terminal to start it, or pick up where you
                left off:
              </p>
            </div>
            {resume?.handoff &&
              items.some(
                (it) => it.kind === "command" && it.command === "/clear"
              ) && (
              <div className="flex items-center gap-2">
                <CopyChip
                  label={`copy handoff kickoff · ${resume.handoff.name}`}
                  text={`Read "${resume.handoff.path}" in full — it's the latest handoff memo — then pick up where it left off.`}
                />
                <span className="text-[11px] text-zinc-600">
                  paste in your terminal —{" "}
                  {lineage?.predecessor
                    ? `picks up ${lineage.predecessor.id.slice(0, 8)} on fresh context`
                    : "starts fresh from the memo"}
                </span>
              </div>
            )}
            {resume && <RecentSessions sessions={resume.sessions} now={now} />}
          </div>
        )}
        </div>
      </div>

        {showJump && (
          <button
            onClick={() => {
              const el = scrollRef.current;
              if (!el) return;
              suppressJumpRef.current = true; // hide the arrow for the whole glide
              el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
              atBottomRef.current = true;
              setShowJump(false);
              // backstop in case scroll settles without an at-bottom onScroll tick
              setTimeout(() => {
                suppressJumpRef.current = false;
              }, 700);
            }}
            // Inline position/z so it can't be broken by a flaky CSS regen (z-20
            // was dropping out); floats centered, 30px above the scroll bottom.
            style={{
              position: "absolute",
              bottom: 30,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
            }}
            title="jump to latest"
            aria-label="Jump to latest"
            className="flex size-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-base leading-none text-zinc-300 shadow-lg transition-colors hover:border-zinc-500 hover:text-zinc-100"
          >
            ↓
          </button>
        )}
      </div>

      {/* Bottom dock — status + composer, centered to the conversation column
          when `centered` (else `display:contents`, unchanged). */}
      <div className={colWrap}>
      {/* Divergence net — a rival (still-open TUI) process wrote a branch into the
          SAME transcript HQ is driving. A distinct amber banner ABOVE the status
          line (not folded into the interrupt border). LATCHED client-side; gated
          on !staged (the staging view follows the newest session, not this one).
          v1 actions stay IN-TERMINAL (no panel nav → no pin-carrying needed):
          "keep HQ" dismisses the latch; "view" is a v1 no-op placeholder. */}
      {!staged && diverged && (
        <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-xs text-amber-300">
          <p className="flex items-baseline gap-1.5">
            <span aria-hidden>⚠</span>
            <span>The terminal also wrote here — you have a branch.</span>
          </p>
          {diverged.preview && (
            <p className="truncate pl-5 text-[11px] text-amber-200/70" title={diverged.preview}>
              {diverged.preview}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pl-5 pt-0.5">
            <button
              type="button"
              onClick={() => {
                divergeAckRef.current.add(pinned ?? resolvedId ?? "");
                setDiverged(null);
              }}
              title="dismiss — keep HQ's branch as the active conversation"
              className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[11px] text-amber-300 transition-colors hover:bg-amber-500/20"
            >
              keep HQ
            </button>
            <button
              type="button"
              onClick={() => {
                divergeAckRef.current.add(pinned ?? resolvedId ?? "");
                setDiverged(null);
              }}
              title="dismiss this notice (v1 — branch viewer not yet wired)"
              className="rounded border border-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-300/70 transition-colors hover:bg-amber-500/20"
            >
              dismiss
            </button>
          </div>
        </div>
      )}
      {/* Warn-before-fork — this session isn't channel-aware, so the next send
          can't push into the live terminal; it resumes a COPY and answers here,
          and the two surfaces diverge. Gate the first such send behind an
          explicit, plain-language confirm (set in doSend; cleared by either
          button). Amber like the divergence net — same family, but PREVENTION
          (before the fork) rather than DETECTION (after). */}
      {forkWarn && (
        <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 font-mono text-xs text-amber-200">
          <p className="flex items-baseline gap-1.5 font-semibold text-amber-300">
            <span aria-hidden>⚠</span>
            <span>Sending will fork this session.</span>
          </p>
          <p className="pl-5 leading-relaxed text-amber-200/90">
            This session wasn’t launched channel-aware, so hq can’t type into your
            live terminal. Pressing send resumes a <em>copy</em> from disk and
            answers <em>here</em> — your open terminal keeps its own thread, so the
            two diverge (that’s the “you have a branch” warning).
          </p>
          <p className="pl-5 leading-relaxed text-amber-200/70">
            Recommended: minimize or close the terminal for this session and keep
            working in hq only, so there’s a single writer. (To avoid forking
            entirely, relaunch it with <span className="text-amber-200">claude-hq</span> — a
            channel-aware session pushes in live, no fork.)
          </p>
          <div className="flex flex-wrap gap-2 pl-5 pt-0.5">
            <button
              type="button"
              onClick={confirmFork}
              title="resume a copy here and continue in hq (forks the terminal's branch)"
              className="rounded border border-amber-500/60 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/25"
            >
              Fork &amp; continue in hq
            </button>
            <button
              type="button"
              onClick={() => setForkWarn(null)}
              title="cancel — leave your draft in the box and don’t send"
              className="rounded border border-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300/70 transition-colors hover:bg-amber-500/20"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* Status / live-working indicator — decoupled from the message scroll so
          it sits as a bar DIRECTLY above the send box: always visible (never
          scrolls away) and it frees the send box's top-right corner for its
          chip. esc/error feedback rides here too. */}
      {status ? (
        <div className="flex flex-col gap-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs">
            <span className="text-orange-400">✶ {mood}…</span>
            <span className="text-zinc-500">
              {`(${fmtElapsed(elapsed)}${
                status.outputTokens > 0
                  ? ` · ↑ ${fmtTokens(status.outputTokens)} tokens`
                  : ""
              }${status.phase ? ` · ${status.phase}` : ""})`}
            </span>
          </p>
        </div>
      ) : sending ? (
        <p className="font-mono text-xs text-zinc-500">starting…</p>
      ) : interrupted ? (
        <p className="font-mono text-xs text-red-400">
          ⊘ interrupted — send a message to redirect
        </p>
      ) : !loading && lastWrite && now > 0 ? (
        <p className="font-mono text-xs text-amber-400">
          ◦ idle — nothing running
          {now > lastWrite && ` · last activity ${fmtAgo(now - lastWrite)}`}
        </p>
      ) : null}
      {escArmed && (
        <p className="font-mono text-[11px] text-zinc-500">
          press esc again to interrupt
        </p>
      )}
      {escNote && (
        <p className="font-mono text-[11px] text-zinc-500">{escNote}</p>
      )}
      {error && (
        <p className="whitespace-pre-wrap font-mono text-xs text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-col">
        {/* Launch-target banner — the Claude pattern: a strip BEHIND the input that
            peeks out the top. The input card sits in front (z-10, opaque bg) and
            overlaps the banner's lower edge via -mb-3, so only the top shows. Only
            when a project chip is selected; ✕ clears back to ~/hq. */}
        {staged && selectedTarget && (
          <div className="-mb-3 flex items-center justify-between gap-2 rounded-t-lg border border-b-0 border-zinc-800 bg-zinc-900/60 px-3 pb-4 pt-1.5 font-mono text-[11px]">
            <span className="min-w-0 truncate text-zinc-400">
              launches in{" "}
              <span className="text-zinc-200" title={selectedTarget.cwd ?? selectedTarget.newProject}>
                {selectedTarget.name}
                {selectedTarget.newProject && <span className="text-zinc-500"> · new</span>}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setSelectedTarget(null)}
              title="clear — back to ~/hq"
              className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-300"
            >
              ✕
            </button>
          </div>
        )}
        {/* Search-mode indicator — peeks above the send box like the launch
            banner (same -mb-3 overlap), signaling the box is in search mode. */}
        {searchMode && (
          <div className="-mb-3 flex items-center gap-2 rounded-t-lg border border-b-0 border-zinc-800 bg-zinc-900/60 px-3 pb-5 pt-1.5 font-mono text-[11px] text-zinc-400">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            searching session{" "}
            <span className="text-yellow-300">
              {customTitle || resolvedId?.slice(0, 8) || "this session"}
            </span>
          </div>
        )}
        {/* textarea + controls; ↵ sends / ⇧↵ newline. Drops are caught at the
            pane root (the whole basin); paste + 📎 still funnel through addFiles. */}
        {/* Claude-chat shape: the textarea on top (auto-grows ~1→8 lines, then
            scrolls), a full-width toolbar row beneath. Bottom-anchored, so growth
            pushes the top up into the message area. */}
        <div
          className="relative z-10 flex flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-950 p-2 transition-colors focus-within:border-zinc-500"
        >
          {/* The send box's own boundary chip — top-right of its SOLID 1px border
              (everything else uses the dashed Boundary). Anticipatory name
              (send-box.tsx, pending the To Do extraction) but copies the path the
              code lives at TODAY — app/ui/terminal.tsx. */}
          <span className="absolute -top-2.5 right-3 z-10">
            {/* the chip is the search-mode signal — it goes yellow while the box
                is in "search this session" (border/banner stay traditional). */}
            <BoundaryChip
              label="send-box.tsx"
              copyText="app/ui/terminal.tsx"
              className={
                searchMode ? "!bg-yellow-300 !text-zinc-900 hover:!text-zinc-900" : ""
              }
            />
          </span>
          {/* Search-this-session mode — the box BECOMES the search bar (reuses the
              header's in-transcript highlighter + match nav). The compose UI below
              hides while it's active; the ✕ / Esc returns to compose. */}
          {searchMode && (
            <SendBoxSearch
              value={searchQuery}
              onChange={setSearchQuery}
              inputRef={sendSearchInputRef}
              matchCount={searchMatchCount}
              activeIndex={searchActiveIndex}
              userOnly={searchUserOnly}
              onToggleUserOnly={() => setSearchUserOnly((v) => !v)}
              onPrev={() => gotoMatch(-1)}
              onNext={() => gotoMatch(1)}
              onClose={closeSendSearch}
            />
          )}
          {!searchMode && (
            <>
          {/* Attached images ride INSIDE the box (Claude-chat shape), above the
              textarea — same size/styling as before, just relocated in. */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a) => (
                <div key={a.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${a.mime};base64,${a.data}`}
                    alt={a.name}
                    className="h-14 w-14 rounded-md border border-zinc-700 object-cover"
                  />
                  <button
                    onClick={() =>
                      setAttachments((list) => list.filter((x) => x.id !== a.id))
                    }
                    title="remove"
                    aria-label="Remove image"
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-zinc-600 bg-zinc-900 text-[10px] text-zinc-400 transition-colors hover:text-zinc-100"
                  >
                    ✕
                  </button>
                  <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-black/60 px-1 text-center text-[9px] text-zinc-300">
                    {Math.max(1, Math.round(a.bytes / 1024))}kb
                  </span>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.items)
                .filter(
                  (it) => it.kind === "file" && it.type.startsWith("image/")
                )
                .map((it) => it.getAsFile())
                .filter((f): f is File => !!f);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              // Enter sends — or, in the new-session view, STARTS the session
              // (doSend → birthAndDrive in the home dir). ⇧↵ is a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                doSend();
              }
            }}
            rows={1}
            disabled={notConnected || locked}
            placeholder={
              notConnected
                ? "run HQ locally and open a session to chat here"
                : locked
                  ? "🔒 locked while active"
                  : staged
                    ? selectedTarget
                      ? `message ${selectedTarget.name} — ↵ launches it`
                      : "write your first message — ↵ launches in ~/hq (or pick a project)"
                    : "↵ send · ⇧↵ newline"
            }
            className="scrollbar-slim max-h-[176px] min-h-[40px] w-full resize-none overflow-y-auto bg-transparent px-1 py-0.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.currentTarget.value = "";
            }}
          />
          <div className="flex w-full items-center gap-2">
            {/* attach — the Projects panel's bare-icon (+) button, reused for a
                consistent design; keeps its attach-a-screenshot function. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach"
              title="attach a screenshot — pasting or dropping an image works too"
              className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
            {/* search this session — the magnifier next to "+" flips the box into
                search mode (reuses the header's in-transcript highlighter). */}
            {!notConnected && !!resolvedId && (
              <button
                type="button"
                onClick={() => setSearchMode(true)}
                aria-label="Search this session"
                title="search this session"
                className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </button>
            )}
            {/* todos — grouped with attach + search on the left. A search +
                scrollable-rows dropdown over the HQ To Do store: pick a row to
                drop it into the box, or add the current message as a new to-do. */}
            <TodoMenu
              draft={draft}
              onAddDraft={todoDraft}
              onPick={(text) => {
                setDraft((d) =>
                  d.trim() ? `${d.replace(/\s+$/, "")}\n${text}` : text
                );
                taRef.current?.focus();
              }}
            />
            {/* right cluster, bottom-right: cache + model + send. */}
            <div className="ml-auto flex items-center gap-2">
              {/* ctx % then cache meter — they live here in the send-box toolbar
                  in BOTH wide screen and the centered (focus) shell, just before
                  the model selector. ctx sits immediately to the left of cache. */}
              {ctxMeter}
              {meter}
              {/* model picker — defaults to the model read from the transcript;
                  your pick rides on the send as `claude --model <id>`, which sets
                  the resumed session's model. Dropdown opens up-and-right. */}
              {!staged && !notConnected && (
                <div ref={modelMenuRef} className="relative min-w-0 shrink">
                  <button
                    type="button"
                    onClick={() => setModelOpen((o) => !o)}
                    title="model for this session — applied via claude --model on your next send"
                    className="flex max-w-full items-center rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    <span className="truncate">
                      {modelLabel(chosenModel ?? model) || "model"}
                    </span>
                  </button>
                  {modelOpen && (
                    <div className="absolute bottom-full right-0 z-30 mb-1 w-60 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-950 py-1 shadow-xl">
                      {MODELS.map((m) => {
                        const active =
                          modelLabel(m.id) === modelLabel(chosenModel ?? model);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setChosenModel(m.id);
                              setModelOpen(false);
                            }}
                            className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-zinc-900"
                          >
                            <span className="flex flex-col">
                              <span
                                className={`font-mono text-xs ${
                                  active ? "text-zinc-100" : "text-zinc-300"
                                }`}
                              >
                                {modelLabel(m.id)}
                              </span>
                              <span className="font-mono text-[10px] text-zinc-600">
                                {m.desc}
                              </span>
                            </span>
                            {active && <span className="shrink-0 text-blue-400">✓</span>}
                          </button>
                        );
                      })}
                      <p className="mt-1 border-t border-zinc-800 px-3 pb-0.5 pt-1.5 font-mono text-[10px] text-zinc-600">
                        applied on your next send
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* send (↑) → while a run is in flight, becomes the red stop button
                  with the traditional white square. */}
              {sending ? (
                <button
                  type="button"
                  onClick={stopSend}
                  aria-label="Stop"
                  title="stop — kill the HQ-spawned run"
                  className="flex shrink-0 items-center rounded-md border border-red-500/70 bg-red-500/20 p-1.5 text-red-50 transition-colors hover:bg-red-500/30"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={doSend}
                  disabled={!canSend}
                  aria-label="Send"
                  title="send (↵)"
                  className={`flex shrink-0 items-center rounded-md p-1.5 transition-colors ${
                    canSend
                      ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                      : "cursor-not-allowed text-zinc-600"
                  }`}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m5 12 7-7 7 7" />
                    <path d="M12 19V5" />
                  </svg>
                </button>
              )}
            </div>
          </div>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
