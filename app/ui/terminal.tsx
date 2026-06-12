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
  const [status, setStatus] = useState<Status>(null); // live "working" status from the transcript
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

  async function send() {
    const prompt = [...queue, draft.trim()].filter(Boolean).join("\n\n");
    if (!prompt || sending) return;
    setQueue([]);
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
        body: JSON.stringify({ prompt, sessionId: pinned ?? undefined }),
      });
      if (!res.ok) {
        setError((await res.text()) || `error ${res.status}`);
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
      setError(String(e));
    } finally {
      setSending(false);
      busyRef.current = false;
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* mb-1.5 — Brendan's 6px of air between the header and the stream */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-xs">
          <span
            className={`size-2 rounded-full ${pinned ? "bg-blue-500" : "bg-green-500"}`}
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
          {pinned ? (
            <Link
              href="/sessions"
              scroll={false}
              className="font-mono text-[11px] text-blue-400 hover:text-blue-300"
            >
              pinned · unpin →
            </Link>
          ) : (
            <span className="font-mono text-[11px] text-zinc-600">
              newest · live
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
          it.kind === "turn" ? (
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
        {/* one container: textarea + controls inside, ↵ sends / ⇧↵ newline */}
        <div className="flex items-end gap-2 rounded-md border border-zinc-700 bg-zinc-950/60 p-2 transition-colors focus-within:border-zinc-500">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder={`message ${project || "session"} — ↵ send · ⇧↵ newline`}
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
          <button
            onClick={send}
            disabled={sending || (!draft.trim() && queue.length === 0)}
            className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending
              ? "…"
              : queue.length > 0
                ? `send ×${queue.length + (draft.trim() ? 1 : 0)}`
                : "send"}
          </button>
        </div>
      </div>
    </div>
  );
}
