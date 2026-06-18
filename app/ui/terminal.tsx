"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "@/app/ui/md";
import BoundaryChip from "@/app/ui/boundary-chip";
import SearchField from "@/app/ui/search-field";
import PanelMenu from "@/app/ui/panel-menu";
import { useRepl } from "@/app/ui/use-repl";
import { OnboardingConversation } from "@/app/ui/landing-install";
import { CONTEXT_LIMIT, PRICING_CLIFF } from "@/lib/limits";
import type { TimelineItem } from "@/lib/transcript";

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
::highlight(hq-search-pair) { background-color: rgba(250, 204, 21, 0.28); color: #fde68a; }
::highlight(hq-search-active-session),
::highlight(hq-search-active-pair) { background-color: #facc15; color: #18181b; }`;
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
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

// The Anthropic prompt cache holds ~5 minutes; reply inside the window and the
// whole history is read at ~10% price. The header counts the window down.
const CACHE_TTL_MS = 5 * 60 * 1000;
// CONTEXT_LIMIT (1M window) + PRICING_CLIFF (200k cliff marker) live in
// lib/limits — imported above so the client bundle never pulls in node:fs.

// Module-scoped so it survives re-renders; stays 1 across soft nav (proof the
// terminal is not remounting). Resets only on a full reload.
let mountCount = 0;

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

// Sibling of the copy button: save a message block as a searchable note (.md
// under ~/.claude/hq/notes). Flips to a green check and stays lit once saved
// (the block also takes a blue border).
function NoteButton({ saved, onSave }: { saved: boolean; onSave: () => void }) {
  return (
    <button
      onClick={onSave}
      title={saved ? "saved as note" : "save as a searchable note"}
      aria-label="Save as note"
      className={`absolute right-9 top-2 rounded-md border bg-zinc-900 p-1.5 transition ${
        saved
          ? "border-green-600/60 text-green-400 opacity-100"
          : "border-zinc-700 text-zinc-500 opacity-0 hover:text-zinc-200 focus:opacity-100 group-hover/turn:opacity-100"
      }`}
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
        {saved ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M15 3v5h5" />
            <line x1="8" y1="13" x2="14" y2="13" />
            <line x1="8" y1="17" x2="14" y2="17" />
          </>
        )}
      </svg>
    </button>
  );
}

// Hover-reveal copy button for a message block — grab a reply/prompt verbatim
// instead of asking Claude to reprint it.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label="Copy message"
      className="absolute right-2 top-2 rounded-md border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-500 opacity-0 transition-opacity hover:text-zinc-200 focus:opacity-100 group-hover/turn:opacity-100"
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
        {copied ? (
          <path d="M20 6 9 17l-5-5" className="text-green-500" />
        ) : (
          <>
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </>
        )}
      </svg>
    </button>
  );
}

// Recent-session rows shared by the fresh pane and the "+" staging view:
// click = show in the terminal, chip = copy the full-context reopen command.
function RecentSessions({
  sessions,
  now,
}: {
  sessions: NonNullable<ResumeOptions>["sessions"];
  now: number;
}) {
  if (sessions.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] text-zinc-600">
        recent sessions — click to open here · reopen = full context in your
        terminal
      </p>
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-2">
          <Link
            href={`/?session=${s.id}`}
            scroll={false}
            title="open this session in the terminal"
            className="group/resume flex min-w-0 flex-1 items-baseline gap-2 rounded-md border border-zinc-800 px-2.5 py-1.5 transition-colors hover:border-zinc-600"
          >
            <span className="shrink-0 text-zinc-300 group-hover/resume:text-zinc-100">
              {s.project}
            </span>
            <span className="shrink-0 text-[11px] text-zinc-600">
              {s.id.slice(0, 8)} · {fmtAgo(now - s.lastActive)}
              {s.contextTokens > 0 && ` · ctx ${fmtTokens(s.contextTokens)}`}
            </span>
            {s.snippet && (
              <span className="min-w-0 truncate text-[11px] text-zinc-500">
                {s.snippet}
              </span>
            )}
          </Link>
          <CopyChip
            label="reopen full session"
            text={`claude --resume ${s.id}`}
          />
        </div>
      ))}
    </div>
  );
}

export default function Terminal({
  paramKey = "session",
}: {
  // Which URL param this terminal reads/writes for its session. Terminal 1 (the
  // shell's always-mounted heart) uses "session"; Terminal 2 (the pair pane)
  // uses "pair", so the two never collide. API query params stay "session"
  // (that's the endpoint's name) — only the browser URL key changes.
  paramKey?: "session" | "pair";
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
  const [lastWrite, setLastWrite] = useState<number | null>(null);
  const [idCopied, setIdCopied] = useState(false); // header session-id copy flash
  const [focusMode, setFocusMode] = useState(false); // centered "conversation shell" toggle for a live session (the not-connected state forces it on)
  const [driveMode, setDriveMode] = useState(false); // "Drive from HQ": route the send box to the live REPL (Terminal 1 only)
  const [starting, setStarting] = useState<string | null>(null); // a project being born-and-driven from the staging view
  const [searchOpen, setSearchOpen] = useState(false); // header search expanded?
  const [searchQuery, setSearchQuery] = useState(""); // raw input — updates instantly so typing never lags
  const [appliedQuery, setAppliedQuery] = useState(""); // debounced — what the (heavy) DOM walk actually runs
  const [searchMatchCount, setSearchMatchCount] = useState(0); // hits in the transcript
  const [searchActiveIndex, setSearchActiveIndex] = useState(0); // which hit is current
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  const [interrupted, setInterrupted] = useState(false); // last turn ended on a hard interrupt
  const [resume, setResume] = useState<ResumeOptions>(null); // fresh-session resume options
  const [projects, setProjects] = useState<string[]>([]); // ~/code dirs for the "+" launcher
  const [lineage, setLineage] = useState<Lineage>(null); // this session's /clear chain
  const [predecessorCtx, setPredecessorCtx] = useState(0); // continued session's ctx size (fresh pane)
  const [now, setNow] = useState(0); // ticks every 1s while working, for elapsed
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
  const stagedAtRef = useRef(0); // when the "+" staging view was entered
  const rootRef = useRef<HTMLDivElement>(null); // pane root — to reach the enclosing boundary box
  const wasThinkingRef = useRef(false); // tracks the working→done edge for the green flash
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // debounce orange→green
  const dismissRef = useRef<(() => void) | null>(null); // detaches the held-green engagement listeners
  const working = status !== null;
  itemsLenRef.current = items.length; // latest item count, for the scrollback anchor

  // Live REPL — only Terminal 1 drives, and only a real pinned session. When
  // `driveMode` is on, the send box routes here (warm process) instead of the
  // one-shot -p; tokens stream back live and tool permissions surface as cards.
  const drivenSessionRef = useRef<string | null>(null); // which session drive was turned on FOR
  const repl = useRepl(resolvedId, driveMode && paramKey === "session");
  // Drive is PER-SESSION: switching the pinned session turns it back off, so HQ
  // never auto-drives whatever you click (which spawned orphan processes + churned
  // Recents). Re-enable per session via the pill. `pinned` is immediate (URL), so
  // it doesn't false-trip during the birth→navigate handoff to the new id.
  useEffect(() => {
    if (driveMode && pinned && drivenSessionRef.current && pinned !== drivenSessionRef.current) {
      setDriveMode(false);
      drivenSessionRef.current = null;
    }
  }, [pinned, driveMode]);

  // In-session find-in-page. `q` is the DEBOUNCED query — the heavy DOM walk +
  // highlight build runs off this, so typing into the box stays instant even on a
  // huge transcript (the input is driven by `searchQuery`, which updates every
  // keystroke). Per-pane highlight keys (Terminal 1 = "session", 2 = "pair") keep
  // the two terminals from clobbering each other's registry entries.
  const q = appliedQuery.trim().toLowerCase();
  const searching = searchOpen && q.length > 0;
  const hlName = `hq-search-${paramKey}`;
  const hlActiveName = `hq-search-active-${paramKey}`;
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
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

  // Focus the box the moment it expands (it's always mounted for the width
  // animation, so autoFocus won't refire — focus imperatively instead).
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

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

  useEffect(() => {
    mountCount += 1;
    console.log(`[terminal] mounted — count=${mountCount}`);
  }, []);

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
    try {
      const d = await (await fetch(`/api/terminal/turns${q}${fullQ}`)).json();
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
      setInterrupted(d.interrupted ?? false);
      setContextTokens(d.contextTokens ?? 0);
      setModel(d.model ?? "");
      setLastWrite(d.lastWrite || null);
      setNow(Date.now());
    } catch {
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

  // Search opened → pull the FULL transcript so find-in-page covers everything,
  // not just the loaded tail. loadOlder no-ops if already expanded / nothing more.
  useEffect(() => {
    if (searchOpen) loadOlder();
  }, [searchOpen, loadOlder]);

  // Build the match list for the active query across the WHOLE transcript — text
  // inside collapsed tool steps included. Cheap on purpose: one TreeWalker pass of
  // (node, offset) pairs, NO per-step textContent serialization and NOTHING opened
  // — so it stays snappy regardless of transcript size or hit count. Only visible
  // hits get highlighted now; collapsed ones are revealed lazily on navigation.
  useEffect(() => {
    const api = highlightApi();
    const container = scrollRef.current;
    if (!api || !container || !searching) {
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
      for (
        let idx = text.indexOf(q);
        idx !== -1;
        idx = text.indexOf(q, idx + q.length)
      ) {
        matches.push({ node: node as Text, start: idx });
      }
    }
    searchMatchesRef.current = matches;
    registerVisibleHighlights();
    setSearchMatchCount(matches.length);
    setSearchActiveIndex((i) =>
      matches.length ? Math.min(i, matches.length - 1) : 0,
    );
  }, [searching, q, items, hlName, hlActiveName, registerVisibleHighlights]);

  // Navigate to the active hit: reveal it if it's tucked inside a collapsed tool
  // step (then re-light the now-visible siblings), paint it the brighter active
  // shade, and scroll it a third of the way down for context.
  useEffect(() => {
    const api = highlightApi();
    const container = scrollRef.current;
    if (!api || !container) return;
    const matches = searchMatchesRef.current;
    if (!searching || matches.length === 0) {
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
    searching,
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
    setColdFlash("on");
    const out = setTimeout(() => setColdFlash("out"), 3000); // hold, then fade
    const gone = setTimeout(() => setColdFlash("off"), 5000); // unmount by 5s
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [working, lastWrite, now]);

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
  // No dep array: rebinding each render keeps the closures fresh.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (!sending && !working) return;
      if (escTimer.current) clearTimeout(escTimer.current);
      if (!escArmed) {
        setEscArmed(true);
        escTimer.current = setTimeout(() => setEscArmed(false), 2000);
        return;
      }
      setEscArmed(false);
      if (sending) {
        stopSend();
      } else {
        setEscNote(
          "this turn is running in its own terminal — HQ can only interrupt runs it started"
        );
        escTimer.current = setTimeout(() => setEscNote(null), 4000);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
    if (staged) return; // staging view — no session exists to send to
    // Drive mode: route to the warm live REPL (streams back over SSE) instead of
    // the one-shot -p. Optimistic user turn shows immediately; the reply streams
    // into the live overlay, then lands via the transcript poll like any turn.
    if (driveMode) {
      const prompt = draft.trim();
      const imgs = attachments;
      if (!prompt && imgs.length === 0) return;
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
      await repl.send(prompt, imgs.map(({ data, mime }) => ({ data, mime })));
      return;
    }
    const target = pinned ?? resolvedId;
    const prompt = draft.trim();
    const imgs = attachments; // snapshot — survives the clear below
    if (!target || sending || (!prompt && imgs.length === 0)) return;
    sendTargetRef.current = target;
    setAttachments([]);
    stoppedRef.current = false;
    setSending(true);
    busyRef.current = true;
    setError(null);
    const optimistic = [
      prompt,
      imgs.length
        ? `📎 ${imgs.length} image${imgs.length > 1 ? "s" : ""} attached`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    setItems((t) => [
      ...t,
      {
        kind: "turn",
        role: "user",
        text: optimistic,
        at: new Date().toISOString(),
      },
    ]);
    setDraft("");
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          sessionId: target,
          model: chosenModel ?? undefined, // picker override → claude --model
          images: imgs.map(({ data, mime }) => ({ data, mime })),
        }),
      });
      if (!res.ok) {
        // an interrupt already left its marker in the timeline — no error line
        setError(
          stoppedRef.current
            ? null
            : (await res.text()) || `error ${res.status}`
        );
        return;
      }
      const data = await res.json();
      if (data?.output)
        setItems((t) => [
          ...t,
          {
            kind: "turn",
            role: "assistant",
            text: String(data.output).trim(),
            at: new Date().toISOString(),
          },
        ]);
    } catch (e) {
      setError(stoppedRef.current ? null : String(e));
    } finally {
      setSending(false);
      busyRef.current = false;
    }
  }

  // New-session-from-HQ: birth a fresh `claude` in the project dir via the REPL
  // backend, then pin + drive it — no TUI, no copy-paste. The route returns the
  // real session id once the process inits; we navigate the pane to it (drive on).
  async function birthAndDrive(project?: string) {
    if (starting) return;
    setStarting(project ?? "here");
    setError(null);
    try {
      const res = await fetch("/api/terminal/repl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "new", project, model: chosenModel ?? undefined }),
      });
      if (!res.ok) throw new Error((await res.text()) || `error ${res.status}`);
      const data = await res.json();
      if (data?.sessionId) {
        drivenSessionRef.current = data.sessionId; // bind drive to the newborn (survives the navigate)
        setDriveMode(true);
        router.push(hrefFor(data.sessionId), { scroll: false });
      } else {
        throw new Error("no session id returned");
      }
    } catch (e) {
      setError(`couldn't start a session${project ? ` in ${project}` : ""}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStarting(null);
    }
  }

  // Kill the HQ-spawned run; the in-flight POST settles and cleans up state.
  // Aims at the snapshotted send target, so it kills the right run even if a
  // different session card was clicked since. Drops the CLI-style interrupt
  // marker into the timeline — same record the real terminal shows.
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
    try {
      await fetch(`/api/terminal?session=${encodeURIComponent(target)}`, {
        method: "DELETE",
      });
    } catch {
      // the POST's own error path will surface anything real
    }
  }

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
  const notConnected =
    !staged && (previewInstall || (!loading && items.length === 0));
  const centered = notConnected || focusMode;
  const colWrap = centered
    ? "mx-auto flex w-full max-w-3xl flex-col gap-4 px-4"
    : "contents";
  // The send (↑) button is live only when there's something to send to a real
  // session; while a run is in flight it morphs into the red stop button.
  const canSend =
    !staged && !notConnected && (draft.trim() !== "" || attachments.length > 0);

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
            Compose/Planner/Text. Lives here in the header, just left of search
            (its former boundary-trail chip was removed). */}
        <PanelMenu />
        {/* Search — bare icon-button (send-box standard) just after the session
            id. Click expands it into the SearchField primitive (animated width)
            that filters THIS session's transcript; the icon morphs to ×. */}
        {resolvedId && !notConnected && (
          <span className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              aria-label={searchOpen ? "Close search" : "Search this session"}
              title={searchOpen ? "close search" : "search this session"}
              className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              {searchOpen ? (
                // lucide x
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
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              ) : (
                // lucide search
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
              )}
            </button>
            {/* Expanding field — always mounted (so the width animates), the
                reusable SearchField primitive inside. Escape closes + clears. */}
            <span
              className={`overflow-hidden transition-all duration-200 ease-out ${
                searchOpen ? "w-44 opacity-100 sm:w-56" : "w-0 opacity-0"
              }`}
            >
              <SearchField
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="search this session…"
                inputRef={searchInputRef}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeSearch();
                  else if (e.key === "Enter") {
                    e.preventDefault();
                    gotoMatch(e.shiftKey ? -1 : 1); // ↵ next · ⇧↵ prev
                  }
                }}
                className="hq-find-field !py-1 !text-xs"
              />
            </span>
            {searching && (
              <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-zinc-500">
                <button
                  type="button"
                  onClick={() => gotoMatch(-1)}
                  disabled={!searchMatchCount}
                  aria-label="Previous match"
                  title="previous match (⇧↵)"
                  className="flex items-center rounded p-0.5 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  {/* lucide chevron-up */}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m18 15-6-6-6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => gotoMatch(1)}
                  disabled={!searchMatchCount}
                  aria-label="Next match"
                  title="next match (↵)"
                  className="flex items-center rounded p-0.5 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  {/* lucide chevron-down */}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                <span className="tabular-nums" title="↵ next · ⇧↵ previous">
                  {searchMatchCount ? searchActiveIndex + 1 : 0}/{searchMatchCount}
                </span>
              </span>
            )}
          </span>
        )}
        {/* The /clear chain: this session's tied line of continuations.
            Click a row to show that session in the terminal. */}
        {lineage?.chain && (
          <details className="relative">
            <summary
              title="sessions tied together by /clear continuations"
              className="cursor-pointer list-none rounded-md border border-zinc-800 px-1.5 py-px font-mono text-[10px] text-zinc-500 transition-colors marker:content-none [&::-webkit-details-marker]:hidden hover:border-zinc-600 hover:text-zinc-300"
            >
              sessions · {lineage.chain.length} ▾
            </summary>
            <div className="absolute left-0 top-full z-20 mt-1 flex w-72 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
              {lineage.chain.map((c, i) => (
                <Link
                  key={c.id}
                  href={hrefFor(c.id)}
                  scroll={false}
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
          </details>
        )}
        {/* Drive toggle — "drive from HQ": route the send box to the warm live
            REPL instead of the one-shot -p. Green pill while driving (dot pulses
            mid-turn); releasing it stops the process so the TUI can take the wheel.
            Terminal 1 + a real pinned session only. ml-auto pushes the whole
            right cluster (drive · focus) to the edge. */}
        {resolvedId && !notConnected && paramKey === "session" && (
          <button
            type="button"
            onClick={() =>
              setDriveMode((d) => {
                const next = !d;
                if (next) drivenSessionRef.current = resolvedId; // bind drive to THIS session
                else { repl.stop(); drivenSessionRef.current = null; } // releasing → stop
                return next;
              })
            }
            title={
              driveMode
                ? "driving from HQ — click to release (the TUI can take over)"
                : "drive this session from HQ (minimize your TUI first)"
            }
            className={`ml-auto flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[10px] transition-colors ${
              driveMode
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                driveMode
                  ? repl.busy
                    ? "animate-pulse bg-emerald-400"
                    : "bg-emerald-400"
                  : "bg-zinc-600"
              }`}
            />
            {driveMode ? "driving" : "drive"}
          </button>
        )}
        {/* Layout toggle — flips this live session between two real modes: "wide
            screen" (default) and "focus mode" (the centered conversation shell).
            Part of the header cluster, so it rides the centered column WITH the
            metadata when focused. minimize-2 while wide (shrink into focus),
            maximize-2 while focused. Pinned session only. */}
        {resolvedId && !notConnected && (
          <button
            type="button"
            onClick={() => setFocusMode((f) => !f)}
            aria-label={focusMode ? "Wide screen" : "Focus mode"}
            title={
              focusMode
                ? "in focus mode — click to expand to wide screen"
                : "in wide screen — click for focus mode"
            }
            className={`${paramKey === "session" ? "" : "ml-auto "}flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200`}
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
      >
        {/* Centered column when `centered`; `display:contents` (a no-op) when not,
            so the full-width transcript is unchanged. */}
        <div className={colWrap}>
        {/* The "+" staging view: nothing exists yet — say how a session is
            born, offer the recent list, and auto-flip when one appears. No
            handoff kickoff here: that belongs to /clear-born continuations. */}
        {staged && (
          <div className="flex flex-col gap-3 font-mono text-xs">
            <div className="flex flex-col gap-1">
              <p className="text-zinc-400">new session — nothing exists yet</p>
              <p className="text-zinc-600">
                pick a project and HQ <span className="text-emerald-400">drives a fresh session right here</span> —
                no terminal, no copy-paste. It spawns{" "}
                <span className="text-zinc-400">{"claude"}</span> in{" "}
                <span className="text-zinc-400">{"~/code/<name>"}</span> and goes live.
              </p>
            </div>
            {projects.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {projects.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={!!starting}
                    onClick={() => birthAndDrive(p)}
                    title={`start a session in ~/code/${p} and drive it from HQ`}
                    className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                      starting === p
                        ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                        : "border-zinc-700 text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-300"
                    }`}
                  >
                    {starting === p ? `starting ${p}…` : p}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <CopyChip label="copy · cd && claude" text="claude" />
              <span className="text-[11px] text-zinc-600">
                or copy the command to start one yourself in a terminal — this
                pane flips to it the moment it appears
              </span>
            </div>
            {resume && <RecentSessions sessions={resume.sessions} now={now} />}
          </div>
        )}
        {!staged && !previewInstall && loading && items.length === 0 && (
          <p className="text-sm text-zinc-600">loading session…</p>
        )}
        {notConnected && <OnboardingConversation />}
        {!previewInstall && items.map((it, i) =>
          it.kind === "command" ? (
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
          ) : it.kind === "turn" ? (
            <div key={i} className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
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
              <div
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
                <NoteButton
                  saved={savedNotes.has(it.text)}
                  onSave={() => saveNoteBlock(it)}
                />
                <CopyButton text={it.text} />
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
            </div>
          ) : (
            <details
              key={i}
              className="group rounded-md border border-zinc-800 bg-zinc-900/30"
            >
              <summary className="flex cursor-pointer list-none items-baseline gap-2 px-3 py-1.5 font-mono text-xs marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="text-zinc-600 transition-transform group-open:rotate-90">
                  ›
                </span>
                <span
                  className={`shrink-0 text-[10px] uppercase tracking-wide ${
                    it.isError ? "text-red-400" : "text-zinc-500"
                  }`}
                >
                  {it.tool}
                </span>
                <span className="min-w-0 truncate text-zinc-300">{it.title}</span>
                {(it.resultTokens ?? 0) >= 1000 && (
                  <span
                    className={`ml-auto shrink-0 text-[10px] ${
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
              </summary>
              <pre className="scrollbar-none max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-zinc-800 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
                {it.detail}
              </pre>
            </details>
          )
        )}
        {/* Live REPL overlay (drive mode): the in-flight assistant turn streaming
            token-by-token, the current turn's tool calls, and any pending
            permission asks as Approve/Deny cards. Completed turns still land via
            the transcript poll above; this is the instant layer on top. */}
        {driveMode &&
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
          {status.phases.length > 1 && (
            <p className="font-mono text-[11px] text-zinc-600">
              phases · {status.phases.slice(-6).join(" → ")}
            </p>
          )}
        </div>
      ) : sending ? (
        <p className="font-mono text-xs text-zinc-500">starting…</p>
      ) : interrupted ? (
        <p className="font-mono text-xs text-red-400">
          ⊘ interrupted — send a message to redirect
        </p>
      ) : !loading && lastWrite && now > 0 ? (
        <p className="font-mono text-xs text-zinc-600">
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

      <div className="flex flex-col gap-1.5">
        {/* textarea + controls; ↵ sends / ⇧↵ newline. Drops are caught at the
            pane root (the whole basin); paste + 📎 still funnel through addFiles. */}
        {/* Claude-chat shape: the textarea on top (auto-grows ~1→8 lines, then
            scrolls), a full-width toolbar row beneath. Bottom-anchored, so growth
            pushes the top up into the message area. */}
        <div className="relative flex flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-950/60 p-2 transition-colors focus-within:border-zinc-500">
          {/* The send box's own boundary chip — top-right of its SOLID 1px border
              (everything else uses the dashed Boundary). Anticipatory name
              (send-box.tsx, pending the To Do extraction) but copies the path the
              code lives at TODAY — app/ui/terminal.tsx. */}
          <span className="absolute -top-2.5 right-3 z-10">
            <BoundaryChip label="send-box.tsx" copyText="app/ui/terminal.tsx" />
          </span>
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
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                doSend();
              }
            }}
            rows={1}
            disabled={staged || notConnected}
            placeholder={
              notConnected
                ? "run HQ locally and open a session to chat here"
                : staged
                  ? "no session yet — start one in your terminal first"
                  : `message ${project || "session"} — ↵ send · ⇧↵ newline · paste a screenshot`
            }
            className="scrollbar-slim max-h-[176px] min-h-[72px] w-full resize-none overflow-y-auto bg-transparent px-1 py-0.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
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
            {/* right cluster, bottom-right: cache + model + todo + send. */}
            <div className="ml-auto flex items-center gap-2">
              {/* ctx % then cache meter — in wide screen they live here, just
                  before the model selector (in the centered shell they move to the
                  footer instead). ctx sits immediately to the left of cache. */}
              {!centered && ctxMeter}
              {!centered && meter}
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
              {/* todo — same icon-button standard, lucide list-todo glyph. */}
              <button
                type="button"
                onClick={todoDraft}
                aria-label="Add to-do"
                title="add this as a to-do on your HQ list"
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
                  <rect x="3" y="5" width="6" height="6" rx="1" />
                  <path d="m3 17 2 2 4-4" />
                  <path d="M13 6h8" />
                  <path d="M13 12h8" />
                  <path d="M13 18h8" />
                </svg>
              </button>
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
                  className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
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
        </div>
      </div>
      {/* Footer row under the composer (centered shell only): the tagline,
          left-aligned, with the cache/ctx meter inline on the right. */}
      {centered && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-600">
          <span>HQ: The disk is the database.</span>
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {ctxMeter}
            {meter}
          </span>
        </div>
      )}
      </div>
    </div>
  );
}
