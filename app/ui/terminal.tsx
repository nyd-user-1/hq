"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "@/app/ui/md";
import { CONTEXT_LIMIT, PRICING_CLIFF } from "@/lib/limits";
import { PANELS } from "@/app/ui/sidebar-nav";
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
// CONTEXT_LIMIT (1M window) + PRICING_CLIFF (200k premium line) live in
// lib/limits — imported above so the client bundle never pulls in node:fs.
// What the "copy wrap-up prompt" button puts on the clipboard — the cheap
// alternative to letting auto-compact eat the session.
const WRAP_UP_PROMPT = `We're close to the context limit — let's wrap up instead of auto-compacting. 1) Write a handoff note to the vault thread: current state, decisions made, open questions, exact next steps. 2) Save or update memory for anything durable. 3) Commit and push. Then I'll /clear and resume fresh from the note.`;

// Module-scoped so it survives re-renders; stays 1 across soft nav (proof the
// terminal is not remounting). Resets only on a full reload.
let mountCount = 0;

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

export default function Terminal() {
  const router = useRouter();
  const pathname = usePathname();
  const sessionParam = useSearchParams().get("session");
  // ?session=new = the "+" staging view: no session of its own. The stream
  // runs unpinned so the pane can flip to the newborn the moment it appears.
  const staged = sessionParam === "new";
  const pinned = staged ? null : sessionParam; // null = newest session
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [project, setProject] = useState("");
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [queue, setQueue] = useState<string[]>([]); // batched asks — sent as ONE message
  const [error, setError] = useState<string | null>(null);
  const [contextTokens, setContextTokens] = useState(0);
  const [lastWrite, setLastWrite] = useState<number | null>(null);
  const [wrapCopied, setWrapCopied] = useState(false);
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
  const panelsRef = useRef<HTMLDetailsElement>(null); // the "panels" dropdown
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
        setResume(d.resume ?? null);
        setLineage(d.lineage ?? null);
        setPredecessorCtx(d.predecessorCtx ?? 0);
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
  }, [pinned, staged, router, pathname]);

  // Entering the staging view: clear the display (nothing is being shown) and
  // stamp the moment — only sessions born after it count as the newborn.
  useEffect(() => {
    if (!staged) return;
    stagedAtRef.current = Date.now();
    setItems([]);
    setProject("");
    setResolvedId(null);
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

  // Park the current draft in the queue; everything queued goes out as ONE
  // message — one context read instead of several.
  function queueDraft() {
    const t = draft.trim();
    if (!t) return;
    setQueue((q) => [...q, t]);
    setDraft("");
  }

  // The send goes to the session ON SCREEN — its id is snapshotted here, at
  // send time, so "newest" can't silently re-aim it between typing and sending
  // (the 001.8 roulette). The guard lives in the plumbing, not the UI: the API
  // refuses anonymous sends, this never sends one.
  async function doSend() {
    if (staged) return; // staging view — no session exists to send to
    const target = pinned ?? resolvedId;
    const prompt = [...queue, draft.trim()].filter(Boolean).join("\n\n");
    if (!target || !prompt || sending) return;
    sendTargetRef.current = target;
    setQueue([]);
    stoppedRef.current = false;
    setSending(true);
    busyRef.current = true;
    setError(null);
    setItems((t) => [
      ...t,
      { kind: "turn", role: "user", text: prompt, at: new Date().toISOString() },
    ]);
    setDraft("");
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sessionId: target }),
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
  const cliffPct = (PRICING_CLIFF / CONTEXT_LIMIT) * 100; // 200k tick on the bar
  const pastCliff = contextTokens >= PRICING_CLIFF;
  const cacheWarm = cacheLeft !== null && cacheLeft > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* mb-1.5 — Brendan's 6px of air between the header and the stream */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
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
        <span className="font-mono text-[11px] text-zinc-600">
          {resolvedId ? resolvedId.slice(0, 8) : "—"}
        </span>
        {/* The /clear chain: this session's tied line of continuations.
            Click a row to show that session in the terminal. */}
        {lineage?.chain && (
          <details className="relative">
            <summary
              title="sessions tied together by /clear continuations"
              className="cursor-pointer list-none rounded-md border border-zinc-800 px-1.5 py-px font-mono text-[10px] text-zinc-500 transition-colors marker:content-none hover:border-zinc-600 hover:text-zinc-300"
            >
              tree · {lineage.chain.length} ▾
            </summary>
            <div className="absolute left-0 top-full z-20 mt-1 flex w-72 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
              {lineage.chain.map((c, i) => (
                <Link
                  key={c.id}
                  href={`/sessions?session=${c.id}`}
                  scroll={false}
                  className={`flex items-baseline gap-2 rounded px-2 py-1 font-mono text-[11px] transition-colors hover:bg-zinc-900 ${
                    c.id === resolvedId ? "text-zinc-200" : "text-zinc-500"
                  }`}
                >
                  <span className="shrink-0 text-zinc-600">{i + 1}</span>
                  <span className="shrink-0">{c.project}</span>
                  <span className="shrink-0 text-zinc-600">
                    {c.id.slice(0, 8)}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-zinc-600">
                    {c.id === resolvedId
                      ? "in terminal"
                      : i > 0
                        ? `cleared into at ${new Date(c.bornAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                        : `started ${new Date(c.bornAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                  </span>
                </Link>
              ))}
            </div>
          </details>
        )}
        {/* Panels dropdown (mirrors the tree dropdown before it): each entry
            opens a tabbed panel — Activity · Metrics · Console — and the panel's
            own tabs handle sub-navigation, so no sub-items here. */}
        <details ref={panelsRef} className="relative">
          <summary
            title="open a panel"
            className={`flex cursor-pointer list-none items-center rounded-md border px-1.5 py-px font-mono text-[10px] transition-colors marker:content-none [&::-webkit-details-marker]:hidden ${
              PANELS.some((p) => p.routes.includes(pathname ?? ""))
                ? "border-zinc-600 text-zinc-300"
                : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
            }`}
          >
            panels ▾
          </summary>
          <div className="absolute left-0 top-full z-20 mt-1 flex w-36 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
            {PANELS.map((p) => {
              const active = p.routes.includes(pathname ?? "");
              return (
                <Link
                  key={p.href}
                  href={p.href}
                  scroll={false}
                  onClick={() => {
                    if (panelsRef.current) panelsRef.current.open = false;
                  }}
                  className={`rounded px-2 py-1 font-mono text-[11px] transition-colors hover:bg-zinc-900 ${
                    active ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {p.title}
                </Link>
              );
            })}
          </div>
        </details>
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
              className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500"
              title={`context ~${fmtTokens(contextTokens)} of ${fmtTokens(CONTEXT_LIMIT)} (your 1M tier) before auto-compact territory · the tick at ${fmtTokens(PRICING_CLIFF)} is where long-context pricing kicks in (~2× input)`}
            >
              {/* The bar is hidden until 75% — on a 1M window it sits near-empty
                  most of a session, so it's noise. The ctx NUMBER always shows. */}
              {ctxPct >= 75 && (
                <span className="relative h-1 w-14 overflow-hidden rounded-full bg-zinc-800">
                  <span
                    className={`absolute inset-y-0 left-0 ${
                      ctxPct >= 80
                        ? "bg-red-500"
                        : ctxPct >= 70
                          ? "bg-amber-500"
                          : "bg-zinc-600"
                    }`}
                    style={{ width: `${Math.min(100, ctxPct)}%` }}
                  />
                  {/* the long-context pricing cliff — a marker, not the wall */}
                  <span
                    className="absolute inset-y-0 w-px bg-amber-400/60"
                    style={{ left: `${cliffPct}%` }}
                  />
                </span>
              )}
              <span>
                ctx {fmtTokens(contextTokens)}
                {pastCliff && (
                  <span
                    className="ml-1 text-amber-400"
                    title={`past ${fmtTokens(PRICING_CLIFF)} — each turn now bills at the long-context premium (~2× input)`}
                  >
                    premium
                  </span>
                )}
              </span>
            </span>
          )}
        </span>
      </div>
      {ctxPct >= 70 && (
        <div className="-mt-1 mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
          <span className={ctxPct >= 80 ? "text-red-400" : "text-amber-400"}>
            context {Math.round(ctxPct)}% — wrap up at a natural break instead
            of letting auto-compact eat it
          </span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(WRAP_UP_PROMPT);
              setWrapCopied(true);
              setTimeout(() => setWrapCopied(false), 2500);
            }}
            className="rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
          >
            {wrapCopied ? "copied ✓ — paste it in your terminal" : "improve context"}
          </button>
          <span className="text-zinc-600">
            → it writes a handoff memo · /clear · this pane offers the kickoff
          </span>
        </div>
      )}

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
                  it.role === "user"
                    ? "whitespace-pre-wrap border-zinc-700 bg-zinc-900 text-zinc-100"
                    : "border-zinc-800 bg-zinc-900/40 text-zinc-300"
                }`}
              >
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
              <summary className="flex cursor-pointer list-none items-baseline gap-2 px-3 py-1.5 font-mono text-xs marker:content-none">
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
              href={`/sessions?session=${lineage.successor.id}`}
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
                  href={`/sessions?session=${lineage.predecessor.id}`}
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
      </div>

      <div className="flex flex-col gap-1.5">
        {queue.length > 0 && (
          <div className="flex flex-col gap-1">
            {queue.map((q, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-dashed border-zinc-800 px-2.5 py-1 font-mono text-[11px] text-zinc-400"
              >
                <span className="text-zinc-600">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{q}</span>
                <button
                  onClick={() => setQueue((qs) => qs.filter((_, j) => j !== i))}
                  aria-label="Remove queued ask"
                  className="text-zinc-600 transition-colors hover:text-zinc-300"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {/* one container: textarea + controls inside, ↵ sends / ⇧↵ newline */}
        <div className="flex items-end gap-2 rounded-md border border-zinc-700 bg-zinc-950/60 p-2 transition-colors focus-within:border-zinc-500">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                doSend();
              }
            }}
            rows={2}
            disabled={staged}
            placeholder={
              staged
                ? "no session yet — start one in your terminal first"
                : `message ${project || "session"} — ↵ send · ⇧↵ newline`
            }
            className="min-h-0 flex-1 resize-none bg-transparent px-1 py-0.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          <button
            onClick={queueDraft}
            disabled={staged || sending || !draft.trim()}
            title="park this ask — everything queued sends as one message (one context read, not several)"
            className="shrink-0 rounded-md border border-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + queue
          </button>
          {sending ? (
            <button
              onClick={stopSend}
              title="kill the HQ-spawned headless run"
              className="shrink-0 rounded-md border border-red-500/50 px-2.5 py-1 text-xs text-red-400 transition-colors hover:border-red-400 hover:text-red-300"
            >
              stop
            </button>
          ) : (
            <button
              onClick={doSend}
              disabled={staged || (!draft.trim() && queue.length === 0)}
              className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {queue.length > 0
                ? `send ×${queue.length + (draft.trim() ? 1 : 0)}`
                : "send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
