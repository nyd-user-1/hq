"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { ago } from "@/lib/ago";
import { useMailbox } from "@/app/ui/mailbox-state";

// Standalone Mailbox panel — a drill-down from a Teams-panel card. Shows a team's
// inter-agent message traffic (who → whom, newest first) and a composer to message
// a member's inbox. The active team is read from localStorage "hq-mailbox-team"
// (stashed by the Teams panel), falling back to the newest team.

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
type Team = { id: string; name: string; members: { name: string }[] };

const COLOR_MAP: Record<string, string> = {
  blue: "text-blue-400",
  green: "text-green-400",
  red: "text-red-400",
  yellow: "text-yellow-400",
  magenta: "text-fuchsia-400",
  cyan: "text-cyan-400",
};

// "Team c4921e42" from "session-c4921e42".
function teamLabel(id: string): string {
  return `Team ${id.replace(/^session-/, "")}`;
}

export default function MailboxPanel() {
  const { open, setOpen } = useMailbox();
  const [teamId, setTeamId] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [msgs, setMsgs] = useState<Mail[]>([]);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // Resolve the active team once on open (localStorage pick, else newest).
  const resolveTeam = useCallback(async () => {
    let id = "";
    try {
      id = localStorage.getItem("hq-mailbox-team") ?? "";
    } catch {
      /* no storage */
    }
    try {
      const tr = await fetch("/api/teams", { cache: "no-store" }).then((r) => r.json());
      const teams: Team[] = tr?.teams ?? [];
      const t = teams.find((x) => x.id === id) ?? teams[0];
      if (t) {
        setTeamId(t.id);
        setMembers((t.members ?? []).map((m) => m.name));
        return t.id;
      }
    } catch {
      /* offline */
    }
    return "";
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const r = await fetch(`/api/teams/mailbox?team=${encodeURIComponent(id)}`, {
        cache: "no-store",
      }).then((res) => res.json());
      setMsgs(Array.isArray(r.messages) ? r.messages : []);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let id = "";
    resolveTeam().then((rid) => {
      if (!alive) return;
      id = rid;
      load(id);
    });
    const iv = setInterval(() => load(id), 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [open, resolveTeam, load]);

  const send = async () => {
    const body = text.trim();
    const rcpt = to.trim();
    if (!body || !rcpt || !teamId || sending) return;
    setSending(true);
    try {
      await fetch("/api/teams/mailbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ team: teamId, to: rcpt, text: body }),
      });
      setText("");
      load(teamId);
    } catch {
      /* leave the draft */
    } finally {
      setSending(false);
    }
  };

  const unread = msgs.reduce((n, m) => n + (m.read ? 0 : 1), 0);

  return (
    <AppPanel
      rootId="mailbox-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="mailbox-panel.tsx">
        {/* header — Mailbox · team · counts */}
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="font-mono text-[12px] text-zinc-300">Mailbox</span>
          {teamId && <span className="min-w-0 truncate font-mono text-[11px] text-zinc-500">{teamLabel(teamId)}</span>}
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">
            {msgs.length} {msgs.length === 1 ? "message" : "messages"}
            {unread > 0 ? ` · ${unread} new` : ""}
          </span>
        </div>

        {/* feed — who → whom, newest first */}
        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2">
          {msgs.length === 0 ? (
            <p className="font-mono text-[11px] text-zinc-600">no messages yet</p>
          ) : (
            msgs.map((m, i) => (
              <div key={m.id || i} className="font-mono text-[11px] leading-snug">
                <div className="flex items-center gap-1.5">
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
                  <span className="ml-auto shrink-0 text-zinc-600">{m.at ? ago(Date.parse(m.at)) : ""}</span>
                </div>
                <p className="whitespace-pre-wrap break-words pl-4 text-zinc-400">{m.text}</p>
              </div>
            ))
          )}
        </div>

        {/* composer — message a member's inbox */}
        <div className="flex shrink-0 items-center gap-1 border-t border-dashed border-zinc-800 pt-3">
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="shrink-0 rounded border border-zinc-800 bg-zinc-950 px-1 py-1 font-mono text-[11px] text-zinc-300 focus:border-zinc-600 focus:outline-none"
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
            className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none disabled:opacity-50"
          />
        </div>
      </Boundary>
    </AppPanel>
  );
}
