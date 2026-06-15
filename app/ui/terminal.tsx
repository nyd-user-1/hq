"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "@/app/ui/md";
import ButtonChipAction from "@/app/ui/button-chip-action";
import BoundaryChip from "@/app/ui/boundary-chip";
import { CONTEXT_LIMIT, PRICING_CLIFF } from "@/lib/limits";
import type { TimelineItem } from "@/lib/transcript";

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
            href={`/sessions?session=${s.id}`}
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
  // session id → href that re-points THIS terminal. Terminal 1 keeps its
  // existing /sessions route; Terminal 2 sets ?pair on the current path while
  // preserving Terminal 1's ?session.
  const hrefFor = (id: string) => {
    const sp = new URLSearchParams();
    if (paramKey === "session") {
      sp.set("session", id);
      if (sibling) sp.set("pair", sibling); // keep terminal 2 open
      return `/sessions?${sp.toString()}`; // unchanged T1 route
    }
    if (sibling) sp.set("session", sibling); // keep terminal 1
    sp.set("pair", id);
    return `${pathname ?? "/"}?${sp.toString()}`;
  };
  // ?session=new = the "+" staging view: no session of its own. The stream
  // runs unpinned so the pane can flip to the newborn the moment it appears.
  const staged = sessionParam === "new";
  const pinned = staged ? null : sessionParam; // null = newest session
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
  const [lastWrite, setLastWrite] = useState<number | null>(null);
  const [idCopied, setIdCopied] = useState(false); // header session-id copy flash
  const stoppedRef = useRef(false); // true when the user killed the run via stop
  const sendTargetRef = useRef<string | null>(null); // session the in-flight send went to
  const [escArmed, setEscArmed] = useState(false); // first Esc pressed, waiting for the second
  const [escNote, setEscNote] = useState<string | null>(null); // why Esc couldn't interrupt
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>(null); // live "working" status from the transcript
  const [resume, setResume] = useState<ResumeOptions>(null); // fresh-session resume options
  const [projects, setProjects] = useState<string[]>([]); // ~/code dirs for the "+" launcher
  const [lineage, setLineage] = useState<Lineage>(null); // this session's /clear chain
  const [predecessorCtx, setPredecessorCtx] = useState(0); // continued session's ctx size (fresh pane)
  const [now, setNow] = useState(0); // ticks every 1s while working, for elapsed
  const scrollRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false); // true mid-send → don't let a stream tick clobber the optimistic turns
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null); // pending refetch retry
  const stagedAtRef = useRef(0); // when the "+" staging view was entered
  const working = status !== null;

  useEffect(() => {
    mountCount += 1;
    console.log(`[terminal] mounted — count=${mountCount}`);
  }, []);

  const loadTurns = useCallback(async function load() {
    const q = staged
      ? "?staged=1"
      : pinned
        ? `?session=${encodeURIComponent(pinned)}`
        : sibling
          ? `?exclude=${encodeURIComponent(sibling)}` // unpinned: newest, but not Terminal 2's
          : "";
    try {
      const d = await (await fetch(`/api/terminal/turns${q}`)).json();
      if (staged) {
        // Staging view: don't display the newest session — just keep the
        // recent-sessions list fresh and watch for a newborn (a session born
        // after staging). The moment one appears, flip to it.
        setResume(d.resume ?? null);
        setProjects(d.projects ?? []);
        setNow(Date.now());
        if (d.id && (d.bornAt ?? 0) > stagedAtRef.current)
          router.replace(`${pathname}?session=${d.id}`, { scroll: false });
        return;
      }
      // Mid-send, the optimistic items own the view — but always refresh status
      // so the live "working" line shows even while a send is in flight.
      if (!busyRef.current) {
        setItems(d.items ?? []);
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
          router.replace(`${pathname ?? "/"}?${sp.toString()}`, { scroll: false });
        }
      }
      setStatus(d.status ?? null);
      setContextTokens(d.contextTokens ?? 0);
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
  }, [pinned, staged, router, pathname, sibling, paramKey]);

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
    setLastWrite(null);
    setResume(null);
    setPredecessorCtx(0);
  }, [staged]);

  // Backfill on mount and whenever the pinned session changes.
  useEffect(() => {
    setLoading(true);
    setError(null);
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

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, sending, status]);

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

  return (
    <div
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
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800 pb-3">
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
        {/* min-w-0 + wrap so this cluster never overflows under the app panel */}
        <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {cacheLeft !== null &&
            (cacheLeft > 0 ? (
              <span
                className="font-mono text-[11px] text-amber-400"
                title="prompt cache is warm — replying now reads history at ~10% price"
              >
                cache {Math.floor(cacheLeft / 60000)}:
                {String(Math.floor((cacheLeft % 60000) / 1000)).padStart(2, "0")}
              </span>
            ) : (
              <span
                className="font-mono text-[11px] text-zinc-600"
                title="prompt cache expired — the next message re-reads the full history"
              >
                cache cold
              </span>
            ))}
          {contextTokens > 0 && (
            <span
              className="font-mono text-[11px] text-zinc-500"
              title={`~${ctxLeftPct}% of your 1M window left — ${fmtTokens(contextTokens)} of ${fmtTokens(CONTEXT_LIMIT)} used (mirrors the CLI's ctx %)`}
            >
              ctx {ctxLeftPct}%
            </span>
          )}
          {/* ctx bar (hidden until 75% — near-empty most of a 1M session); the
              ctx number itself sits just left of it. */}
          {contextTokens > 0 && ctxPct >= 75 && (
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
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
      >
        {/* The "+" staging view: nothing exists yet — say how a session is
            born, offer the recent list, and auto-flip when one appears. No
            handoff kickoff here: that belongs to /clear-born continuations. */}
        {staged && (
          <div className="flex flex-col gap-3 font-mono text-xs">
            <div className="flex flex-col gap-1">
              <p className="text-zinc-400">new session — nothing exists yet</p>
              <p className="text-zinc-600">
                a session is born when you type in a Claude terminal. pick a
                project — it copies{" "}
                <span className="text-zinc-400">
                  {"cd ~/code/<name> && claude"}
                </span>{" "}
                to paste. starting IN the project sets the working dir, so
                Recents sorts it on its own.
              </p>
            </div>
            {projects.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {projects.map((p) => (
                  <CopyChip
                    key={p}
                    label={p}
                    text={`cd ~/code/"${p}" && claude`}
                  />
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <CopyChip label="copy · claude" text="claude" />
              <span className="text-[11px] text-zinc-600">
                or just here (current dir) — fresh context; this pane flips to
                the new session the moment it appears
              </span>
            </div>
            {resume && <RecentSessions sessions={resume.sessions} now={now} />}
          </div>
        )}
        {!staged && loading && items.length === 0 && (
          <p className="text-sm text-zinc-600">loading session…</p>
        )}
        {!staged && !loading && items.length === 0 && (
          <p className="text-sm text-zinc-600">no session transcript found</p>
        )}
        {items.map((it, i) =>
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
                {it.role === "user" ? "brendan" : "claude"}
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

      {/* Status / live-working indicator — decoupled from the message scroll so
          it sits as a bar DIRECTLY above the send box: always visible (never
          scrolls away) and it frees the send box's top-right corner for its
          chip. esc/error feedback rides here too. */}
      {status ? (
        <div className="flex flex-col gap-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs">
            <span className="text-orange-400">✶ {mood}…</span>
            <span className="text-zinc-500">
              ({fmtElapsed(elapsed)} · ↑ {fmtTokens(status.outputTokens)} tokens
              {status.phase ? ` · ${status.phase}` : ""})
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
            disabled={staged}
            placeholder={
              staged
                ? "no session yet — start one in your terminal first"
                : `message ${project || "session"} — ↵ send · ⇧↵ newline · paste a screenshot`
            }
            className="max-h-[176px] min-h-[72px] w-full resize-none overflow-y-auto bg-transparent px-1 py-0.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
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
            <ButtonChipAction
              label="attach"
              ariaLabel="Attach"
              title="attach a screenshot — pasting or dropping an image works too"
              onClick={() => fileInputRef.current?.click()}
            />
            <ButtonChipAction
              label="todo"
              accent="text-violet-300"
              title="add this as a to-do on your HQ list"
              onClick={todoDraft}
            />
            {sending && (
              <button
                onClick={stopSend}
                title="kill the HQ-spawned headless run"
                className="ml-auto shrink-0 rounded-md border border-red-500/50 px-2.5 py-1 text-xs text-red-400 transition-colors hover:border-red-400 hover:text-red-300"
              >
                stop
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
