"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// The persistent heart. Mounted once in the shell (root layout) so it NEVER
// remounts as the sidebar navigates the panel — it only re-renders when
// ?session changes, swapping which session it shows/drives. Client island:
// never imports a node:fs lib; it fetches via /api/terminal/* instead.
type Turn = { role: "user" | "assistant"; text: string; at: string };

// Module-scoped so it survives re-renders; stays 1 across soft nav (proof the
// terminal is not remounting). Resets only on a full reload.
let mountCount = 0;

export default function Terminal() {
  const pinned = useSearchParams().get("session"); // null = newest session
  const [turns, setTurns] = useState<Turn[]>([]);
  const [project, setProject] = useState("");
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false); // true mid-send → don't let a stream tick clobber the optimistic turns

  useEffect(() => {
    mountCount += 1;
    console.log(`[terminal] mounted — count=${mountCount}`);
  }, []);

  const loadTurns = useCallback(async () => {
    const q = pinned ? `?session=${encodeURIComponent(pinned)}` : "";
    try {
      const d = await (await fetch(`/api/terminal/turns${q}`)).json();
      setTurns(d.turns ?? []);
      setProject(d.project ?? "");
      setResolvedId(d.id ?? null);
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
    es.addEventListener("change", () => {
      if (!busyRef.current) loadTurns();
    });
    return () => es.close();
  }, [pinned, loadTurns]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  async function send() {
    const prompt = draft.trim();
    if (!prompt || sending) return;
    setSending(true);
    busyRef.current = true;
    setError(null);
    setTurns((t) => [
      ...t,
      { role: "user", text: prompt, at: new Date().toISOString() },
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
        setTurns((t) => [
          ...t,
          {
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
        {loading && turns.length === 0 && (
          <p className="text-sm text-zinc-600">loading session…</p>
        )}
        {!loading && turns.length === 0 && (
          <p className="text-sm text-zinc-600">no session transcript found</p>
        )}
        {turns.map((t, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              <span
                className={`mr-1.5 normal-case ${
                  t.role === "user" ? "text-blue-500" : "text-orange-500"
                }`}
              >
                ●
              </span>
              {t.role === "user" ? "brendan" : "claude"}
              {t.at && (
                <span className="ml-2 normal-case tracking-normal text-zinc-600">
                  {new Date(t.at).toLocaleTimeString()}
                </span>
              )}
            </span>
            <div
              className={`whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-xs leading-relaxed ${
                t.role === "user"
                  ? "border-zinc-700 bg-zinc-900 text-zinc-100"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-300"
              }`}
            >
              {t.text}
            </div>
          </div>
        ))}
        {sending && (
          <p className="font-mono text-xs text-zinc-500">claude is working…</p>
        )}
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
