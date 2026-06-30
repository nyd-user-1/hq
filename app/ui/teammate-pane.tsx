"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A wall pane for a CC agent-team teammate. Two modes, picked off /api/teams/pane:
//   • tmux split-pane teammate → it's a REAL pane (its own stdin). Show its LIVE
//     terminal (capture-pane) AND a send box that types into it (send-keys). This
//     is the "jump in and talk to teammate 2/3/4" experience — a true peer.
//   • in-process teammate → no pane to drive. Fall back to the read-only
//     transcript (polled from /api/teams/transcript), as before.
// hq's thesis holds: tmux is the OS-level handle Claude Code itself uses for
// split-pane teammates; we read/drive that pane, we don't fork anything.

type Turn = { role: "user" | "assistant"; text: string; at: string };

const COLOR_MAP: Record<string, string> = {
  blue: "text-blue-400",
  green: "text-green-400",
  red: "text-red-400",
  yellow: "text-yellow-400",
  magenta: "text-fuchsia-400",
  cyan: "text-cyan-400",
};

export default function TeammatePane({
  teamId,
  member,
  color: initialColor,
}: {
  teamId: string;
  member: string;
  // The CC color, if the caller happens to know it; otherwise it's resolved live
  // from /api/teams/pane (the "@tm:" wall token carries no color).
  color?: string;
}) {
  // tmux mode: the live captured pane text (null until we know it's a pane).
  const [pane, setPane] = useState<string | null>(null);
  const [isPane, setIsPane] = useState(false);
  // in-process fallback.
  const [turns, setTurns] = useState<Turn[]>([]);
  const [working, setWorking] = useState(false);
  // member metadata resolved from the API (the token carries none).
  const [color, setColor] = useState(initialColor ?? "");
  const [agentType, setAgentType] = useState("");

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll: prefer the tmux pane; fall back to the transcript when it isn't one.
  // /api/teams/pane always returns the member metadata (color/agentType), even in
  // the in-process (paneId === null) case, so the dot + pill are never blank.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const pr = await fetch(
          `/api/teams/pane?team=${encodeURIComponent(teamId)}&member=${encodeURIComponent(member)}`,
        ).then((r) => r.json());
        if (!alive) return;
        if (typeof pr?.color === "string" && pr.color) setColor(pr.color);
        if (typeof pr?.agentType === "string") setAgentType(pr.agentType);
        if (pr?.paneId) {
          setIsPane(true);
          setPane(typeof pr.pane === "string" ? pr.pane : "");
          return;
        }
        setIsPane(false);
        const tr = await fetch(
          `/api/teams/transcript?team=${encodeURIComponent(teamId)}&member=${encodeURIComponent(member)}`,
        ).then((r) => r.json());
        if (!alive) return;
        setTurns(Array.isArray(tr.turns) ? tr.turns : []);
        setWorking(!!tr.working);
        if (typeof tr?.color === "string" && tr.color) setColor(tr.color);
      } catch {
        // transient — keep the last good render
      }
    }
    load();
    const iv = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [teamId, member]);

  // Keep the newest content in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pane, turns]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await fetch("/api/teams/pane", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ team: teamId, member, text }),
      });
      setDraft("");
    } catch {
      /* leave the draft so nothing is lost */
    } finally {
      setSending(false);
    }
  }, [draft, sending, teamId, member]);

  const dotClass = COLOR_MAP[color] ?? "text-zinc-400";
  // drive vs read-only — FILL vs OUTLINE zinc (the observe/control vocabulary),
  // never a hue. A tmux pane is drivable (send-keys into its real stdin); an
  // in-process teammate is observe-only (its transcript). working/idle is a
  // separate, honest activity axis, shown only for the read-only case.
  const badge = isPane
    ? "border border-zinc-600 bg-zinc-700 text-zinc-100" // control — filled
    : "border border-zinc-700 text-zinc-500"; // observe — outline

  return (
    <div className="flex h-full min-h-0 flex-col font-mono text-xs">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className={`shrink-0 ${dotClass}`} aria-hidden>●</span>
        <span className="truncate text-zinc-300">{member}</span>
        {agentType && (
          <span className="shrink-0 rounded bg-zinc-800 px-1 py-0.5 text-[8px] uppercase tracking-wide text-zinc-500">
            {agentType}
          </span>
        )}
        <span
          className={`shrink-0 rounded px-1 py-0.5 text-[8px] uppercase tracking-wide ${badge}`}
          title={isPane ? "drivable — types into its real tmux stdin" : "read-only — its transcript (in-process teammate)"}
        >
          {isPane ? "drive" : "read-only"}
        </span>
        {!isPane && (
          <span className={`shrink-0 ${working ? "text-orange-500" : "text-zinc-600"}`}>
            {working ? "working" : "idle"}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {isPane ? (
          // The teammate's live terminal (raw capture — its actual view).
          <pre className="whitespace-pre-wrap break-words text-zinc-300">
            {pane || "…"}
          </pre>
        ) : turns.length === 0 ? (
          <div className="text-zinc-600">no transcript yet</div>
        ) : (
          turns.map((turn, i) => {
            const isUser = turn.role === "user";
            return (
              <div key={i} className="py-1">
                {turn.text.split("\n").map((ln, j) => {
                  const cls = ln.startsWith("⏺") || isUser ? "text-zinc-500" : "text-zinc-200";
                  return (
                    <div key={j} className={`whitespace-pre-wrap ${cls}`}>
                      {ln === "" ? " " : ln}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* Send box — only for a drivable tmux pane. Enter sends, ⇧↵ newline. */}
      {isPane && (
        <div className="shrink-0 border-t border-zinc-800 p-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={sending ? "sending…" : `message ${member}…`}
            disabled={sending}
            className="scrollbar-none max-h-24 w-full resize-none rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
}
