"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ago } from "@/lib/ago";

// The team MAILBOX feed — a live view of the inter-agent traffic (who → whom, the
// message), read from /api/teams/mailbox. This is how you WATCH a team coordinate:
// task assignments, replies, hand-offs. A small composer beneath lets hq message a
// member directly (an alternate drive path, esp. for in-process teammates that
// have no drivable tmux pane). Collapsed by default with an unread count; polls
// only while open. Cloned-feel from the roster disclosure in teams-panel.tsx.

type Mail = {
  to: string;
  from: string;
  text: string;
  kind: string;
  at: string;
  read: boolean;
  color: string;
  id: string;
};

const COLOR_MAP: Record<string, string> = {
  blue: "text-blue-400",
  green: "text-green-400",
  red: "text-red-400",
  yellow: "text-yellow-400",
  magenta: "text-fuchsia-400",
  cyan: "text-cyan-400",
};

export default function MailboxFeed({ teamId, members }: { teamId: string; members: string[] }) {
  const [msgs, setMsgs] = useState<Mail[]>([]);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/teams/mailbox?team=${encodeURIComponent(teamId)}`, {
        cache: "no-store",
      }).then((res) => res.json());
      setMsgs(Array.isArray(r.messages) ? r.messages : []);
    } catch {
      /* transient — keep the last good feed */
    }
  }, [teamId]);

  // Poll only while expanded (newest-first; the feed shows the freshest traffic on
  // top, so no auto-scroll needed).
  useEffect(() => {
    if (!open) return;
    load();
    const iv = setInterval(load, 3000);
    return () => clearInterval(iv);
  }, [open, load]);

  const send = async () => {
    const body = text.trim();
    const rcpt = to.trim();
    if (!body || !rcpt || sending) return;
    setSending(true);
    try {
      await fetch("/api/teams/mailbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ team: teamId, to: rcpt, text: body }),
      });
      setText("");
      load();
    } catch {
      /* leave the draft so nothing is lost */
    } finally {
      setSending(false);
    }
  };

  const unread = msgs.reduce((n, m) => n + (m.read ? 0 : 1), 0);

  return (
    <div className="mt-3 border-t border-dashed border-zinc-800 pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 font-mono text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <span className={`leading-none transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        mailbox
        <span className="text-zinc-600">{msgs.length}</span>
        {unread > 0 && (
          <span className="rounded bg-orange-500/15 px-1 py-0.5 text-orange-300">{unread} new</span>
        )}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <div ref={scrollRef} className="scrollbar-none flex max-h-48 flex-col gap-2 overflow-y-auto">
            {msgs.length === 0 ? (
              <p className="font-mono text-[10px] text-zinc-600">no messages yet</p>
            ) : (
              msgs.map((m, i) => (
                <div key={m.id || i} className="font-mono text-[10px] leading-snug">
                  <div className="flex items-center gap-1">
                    <span className={COLOR_MAP[m.color] ?? "text-zinc-500"} aria-hidden>
                      ●
                    </span>
                    <span className="text-zinc-300">{m.from || "?"}</span>
                    <span className="text-zinc-600">→</span>
                    <span className="text-zinc-400">{m.to}</span>
                    {!m.read && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-orange-400"
                        title="unread — not yet consumed"
                        aria-hidden
                      />
                    )}
                    <span className="ml-auto shrink-0 text-zinc-600">
                      {m.at ? ago(Date.parse(m.at)) : ""}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words pl-3.5 text-zinc-400">{m.text}</p>
                </div>
              ))
            )}
          </div>

          {/* composer — message a member directly (alt drive path) */}
          <div className="flex items-center gap-1">
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="shrink-0 rounded border border-zinc-800 bg-zinc-950 px-1 py-1 font-mono text-[10px] text-zinc-300 focus:border-zinc-600 focus:outline-none"
            >
              <option value="">to…</option>
              {members.map((mm) => (
                <option key={mm} value={mm}>
                  {mm}
                </option>
              ))}
            </select>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={sending}
              placeholder={sending ? "sending…" : "message a teammate…"}
              className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none disabled:opacity-50"
            />
          </div>
        </div>
      )}
    </div>
  );
}
