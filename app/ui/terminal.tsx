"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "@/app/ui/md";
import { useSidebar } from "@/app/ui/sidebar-state";
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
  const sidebar = useSidebar();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [project, setProject] = useState("");
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, sending, status]);

  async function send() {
    const prompt = draft.trim();
    if (!prompt || sending) return;
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* mb-1.5 — Brendan's 6px of air between the header and the stream */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          onClick={sidebar.toggle}
          aria-label={sidebar.open ? "Collapse sidebar" : "Expand sidebar"}
          className="-ml-1 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          {/* lucide PanelLeftClose / PanelLeftOpen */}
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
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
            {sidebar.open ? (
              <path d="m16 15-3-3 3-3" />
            ) : (
              <path d="m14 9 3 3-3 3" />
            )}
          </svg>
        </button>
        <span className="flex items-center gap-1.5 text-xs">
          <span
            className={`size-2 rounded-full ${pinned ? "bg-blue-500" : "bg-green-500"}`}
          />
          <span className="font-mono text-zinc-300">{project || "session"}</span>
        </span>
        <span className="font-mono text-[11px] text-zinc-600">
          {resolvedId ? resolvedId.slice(0, 8) : "—"}
        </span>
        {pinned ? (
          <Link
            href="/sessions"
            scroll={false}
            className="ml-auto font-mono text-[11px] text-blue-400 hover:text-blue-300"
          >
            pinned · unpin →
          </Link>
        ) : (
          <span className="ml-auto font-mono text-[11px] text-zinc-600">
            newest · live
          </span>
        )}
      </div>

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

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={`message ${project || "session"} — ⌘↵ to send`}
          className="min-h-0 flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
        />
        <button
          onClick={send}
          disabled={sending || !draft.trim()}
          className="shrink-0 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? "…" : "send"}
        </button>
      </div>
    </div>
  );
}
