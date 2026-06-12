"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "@/app/ui/md";
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
  }[];
} | null;

// Spinner mood words, cycled by elapsed — the live "it's alive" flavor the real
// CLI shows ("Sprouting…", "Marinating…").
const MOODS = [
  "Sprouting", "Marinating", "Percolating", "Simmering", "Noodling",
  "Brewing", "Cooking", "Pondering", "Churning", "Conjuring", "Tinkering",
];
function fmtTokens(n: number): string {
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
// Context gauge ceiling — the window auto-compact is protecting.
const CONTEXT_LIMIT = 200_000;
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

export default function Terminal() {
  const pinned = useSearchParams().get("session"); // null = newest session
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
  const [confirming, setConfirming] = useState(false); // send guard dialog open
  const stoppedRef = useRef(false); // true when the user killed the run via stop
  const [status, setStatus] = useState<Status>(null); // live "working" status from the transcript
  const [resume, setResume] = useState<ResumeOptions>(null); // fresh-session resume options
  const [now, setNow] = useState(0); // ticks every 1s while working, for elapsed
  const scrollRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false); // true mid-send → don't let a stream tick clobber the optimistic turns
  const working = status !== null;

  useEffect(() => {
    mountCount += 1;
    console.log(`[terminal] mounted — count=${mountCount}`);
  }, []);

  const loadTurns = useCallback(async () => {
    const q = pinned ? `?session=${encodeURIComponent(pinned)}` : "";
    try {
      const d = await (await fetch(`/api/terminal/turns${q}`)).json();
      // Mid-send, the optimistic items own the view — but always refresh status
      // so the live "working" line shows even while a send is in flight.
      if (!busyRef.current) {
        setItems(d.items ?? []);
        setProject(d.project ?? "");
        setResolvedId(d.id ?? null);
        setResume(d.resume ?? null);
      }
      setStatus(d.status ?? null);
      setContextTokens(d.contextTokens ?? 0);
      setLastWrite(d.lastWrite || null);
      setNow(Date.now());
    } catch {
      // transient — the stream will re-ping
    }
  }, [pinned]);

  // Backfill on mount and whenever the pinned session changes.
  useEffect(() => {
    setLoading(true);
    setError(null);
    setConfirming(false); // a stale confirm must not carry over to a new target
    loadTurns().finally(() => setLoading(false));
  }, [loadTurns]);

  // Live tail: refetch the parsed turns whenever the transcript changes. Skipped
  // while a local send is in flight (the optimistic turns own the view then).
  useEffect(() => {
    const q = pinned ? `?session=${encodeURIComponent(pinned)}` : "";
    const es = new EventSource(`/api/terminal/stream${q}`);
    es.addEventListener("change", () => loadTurns());
    return () => es.close();
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

  // Park the current draft in the queue; everything queued goes out as ONE
  // message — one context read instead of several.
  function queueDraft() {
    const t = draft.trim();
    if (!t) return;
    setQueue((q) => [...q, t]);
    setDraft("");
  }

  // The send guard (001.8): sending spawns a headless Claude that can edit the
  // resumed project's repo. Requires a PINNED target (no "newest" roulette) and
  // an explicit confirm that names the project and prices the context re-read.
  function requestSend() {
    if (sending || !pinned) return;
    if (queue.length === 0 && !draft.trim()) return;
    setConfirming(true);
  }

  async function doSend() {
    setConfirming(false);
    if (!pinned) return;
    const prompt = [...queue, draft.trim()].filter(Boolean).join("\n\n");
    if (!prompt || sending) return;
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
        body: JSON.stringify({ prompt, sessionId: pinned }),
      });
      if (!res.ok) {
        setError(
          stoppedRef.current
            ? "stopped — the headless run was killed"
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
      setError(
        stoppedRef.current ? "stopped — the headless run was killed" : String(e)
      );
    } finally {
      setSending(false);
      busyRef.current = false;
    }
  }

  // Kill the HQ-spawned run; the in-flight POST settles and cleans up state.
  async function stopSend() {
    if (!pinned) return;
    stoppedRef.current = true;
    try {
      await fetch(`/api/terminal?session=${encodeURIComponent(pinned)}`, {
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
  // What a send costs: the headless fork re-reads the whole history — at cache
  // prices if warm (~$1.5/M), full input price if cold (~$15/M, Opus tier).
  const cacheWarm = cacheLeft !== null && cacheLeft > 0;
  const sendCost = (contextTokens / 1e6) * (cacheWarm ? 1.5 : 15);

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
          <span className="font-mono text-zinc-300">{project || "session"}</span>
        </span>
        <span className="font-mono text-[11px] text-zinc-600">
          {resolvedId ? resolvedId.slice(0, 8) : "—"}
        </span>
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
              title={`context ~${fmtTokens(contextTokens)} of ${fmtTokens(CONTEXT_LIMIT)} before auto-compact territory`}
            >
              <span className="h-1 w-14 overflow-hidden rounded-full bg-zinc-800">
                <span
                  className={`block h-full ${
                    ctxPct >= 80
                      ? "bg-red-500"
                      : ctxPct >= 70
                        ? "bg-amber-500"
                        : "bg-zinc-600"
                  }`}
                  style={{ width: `${Math.min(100, ctxPct)}%` }}
                />
              </span>
              ctx {fmtTokens(contextTokens)}
            </span>
          )}
          {/* The send switch — pinning IS arming the send path (001.8), so say
              it like a switch. Off = observe-only, following the newest session. */}
          {pinned ? (
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-zinc-600">
                locked to this session
              </span>
              <Link
                href="/sessions"
                scroll={false}
                title="send is armed at this session — click to switch off (back to observe-only, following newest)"
                className="rounded-md border border-amber-500/40 px-2 py-0.5 font-mono text-[11px] text-amber-400 transition-colors hover:border-amber-400 hover:text-amber-300"
              >
                send · on
              </Link>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-zinc-600">
                following newest
              </span>
              <Link
                href="/sessions"
                scroll={false}
                title="send is off (observe-only) — pick a session card to arm it"
                className="rounded-md border border-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-600 transition-colors hover:border-zinc-600 hover:text-zinc-400"
              >
                send · off
              </Link>
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
              setTimeout(() => setWrapCopied(false), 1500);
            }}
            className="rounded-md border border-zinc-700 px-2 py-0.5 text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
          >
            {wrapCopied ? "copied ✓" : "copy wrap-up prompt"}
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
      >
        {loading && items.length === 0 && (
          <p className="text-sm text-zinc-600">loading session…</p>
        )}
        {!loading && items.length === 0 && (
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
        {!loading && items.length > 0 && items.every((it) => it.kind === "command") && (
          <div className="flex flex-col gap-3 font-mono text-xs">
            <div className="flex flex-col gap-1">
              <p className="text-zinc-400">fresh session — no turns yet</p>
              <p className="text-zinc-600">
                type in your Claude terminal to start it, or pick up where you
                left off:
              </p>
            </div>
            {resume?.handoff && (
              <div className="flex items-center gap-2">
                <CopyChip
                  label={`copy handoff kickoff · ${resume.handoff.name}`}
                  text={`Read "${resume.handoff.path}" in full — it's the latest handoff memo — then pick up where it left off.`}
                />
                <span className="text-[11px] text-zinc-600">
                  paste into your terminal to resume from the memo
                </span>
              </div>
            )}
            {(resume?.sessions.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] text-zinc-600">
                  recent sessions — click to follow here (free) · copy to
                  resume in your terminal
                </p>
                {resume!.sessions.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <Link
                      href={`/sessions?session=${s.id}`}
                      scroll={false}
                      title="pin the terminal to this session — observe-only"
                      className="group/resume flex min-w-0 flex-1 items-baseline gap-2 rounded-md border border-zinc-800 px-2.5 py-1.5 transition-colors hover:border-zinc-600"
                    >
                      <span className="shrink-0 text-zinc-300 group-hover/resume:text-zinc-100">
                        {s.project}
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-600">
                        {s.id.slice(0, 8)} · {fmtAgo(now - s.lastActive)}
                      </span>
                      {s.snippet && (
                        <span className="min-w-0 truncate text-[11px] text-zinc-500">
                          {s.snippet}
                        </span>
                      )}
                    </Link>
                    <CopyChip
                      label="copy resume cmd"
                      text={`claude --resume ${s.id}`}
                    />
                  </div>
                ))}
              </div>
            )}
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
        {confirming && pinned && (
          <div className="flex flex-col gap-2 rounded-md border border-red-500/40 bg-red-500/5 p-3">
            <p className="font-mono text-[11px] leading-relaxed text-zinc-300">
              <span className="text-red-400">⚠ headless fork — </span>
              this spawns a separate Claude resumed from{" "}
              <span className="text-zinc-100">{project || "this session"}</span>{" "}
              ({resolvedId ? resolvedId.slice(0, 8) : "?"}). It can edit files
              and commit in that project, in parallel with any live terminal.
              It will re-read ~{fmtTokens(contextTokens)} tokens of history ≈ $
              {sendCost.toFixed(2)}{" "}
              {cacheWarm
                ? "(cache warm — ~10% price)"
                : "(cache cold — full price)"}
              .
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                autoFocus
                className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
              >
                cancel
              </button>
              <button
                onClick={doSend}
                className="rounded-md border border-red-500/50 px-2.5 py-1 text-xs text-red-400 transition-colors hover:border-red-400 hover:text-red-300"
              >
                send anyway
                {queue.length > 0
                  ? ` ×${queue.length + (draft.trim() ? 1 : 0)}`
                  : ""}
              </button>
            </div>
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
                requestSend();
              }
              if (e.key === "Escape") setConfirming(false);
            }}
            rows={2}
            placeholder={
              pinned
                ? `message ${project || "session"} — ↵ send · ⇧↵ newline`
                : "observe-only · send off — click a session card to arm it"
            }
            className="min-h-0 flex-1 resize-none bg-transparent px-1 py-0.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          <button
            onClick={queueDraft}
            disabled={sending || !draft.trim()}
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
              onClick={requestSend}
              disabled={!pinned || (!draft.trim() && queue.length === 0)}
              title={
                pinned
                  ? undefined
                  : "send is off — an unaimed send could resume the wrong session (the 001.8 incident); pick a session card to arm it"
              }
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
