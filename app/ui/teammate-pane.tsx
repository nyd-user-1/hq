"use client";

import { useEffect, useRef, useState } from "react";

// A read-only "teammate pane" for the wall: it shows a CC agent-team teammate's
// live transcript by polling /api/teams/transcript (which reads the teammate's
// JSONL off disk). Self-contained, no border — the wall pane's Boundary frames it.
// hq's thesis: read what Claude wrote to disk; this only ever READS.

type Turn = { role: "user" | "assistant"; text: string; at: string };

// color (from the team config) → a Tailwind text color for the status dot.
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
  label,
  color,
}: {
  teamId: string;
  member: string;
  label: string;
  color?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [working, setWorking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Poll the teammate transcript every 2s; clear on unmount.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(
          `/api/teams/transcript?team=${encodeURIComponent(teamId)}&member=${encodeURIComponent(member)}`,
        );
        const d = await r.json();
        if (!alive) return;
        setTurns(Array.isArray(d.turns) ? d.turns : []);
        setWorking(!!d.working);
      } catch {
        // transient fetch error — keep the last good render
      }
    }
    load();
    const iv = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [teamId, member]);

  // Auto-scroll to the newest turn.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const dotClass = COLOR_MAP[color ?? ""] ?? "text-zinc-400";

  return (
    <div className="flex h-full min-h-0 flex-col font-mono text-xs">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <span className={dotClass}>●</span>
        <span className="text-zinc-300">{label}</span>
        <span className="text-zinc-500">{member}</span>
        <span className={working ? "text-orange-500" : "text-zinc-500"}>
          {working ? "working" : "idle"}
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {turns.length === 0 ? (
          <div className="text-zinc-600">no transcript yet</div>
        ) : (
          turns.map((turn, i) => {
            const isUser = turn.role === "user";
            return (
              <div key={i} className="py-1">
                {turn.text.split("\n").map((ln, j) => {
                  const isTool = ln.startsWith("⏺");
                  const cls = isTool
                    ? "text-zinc-500"
                    : isUser
                      ? "text-zinc-500"
                      : "text-zinc-200";
                  return (
                    <div key={j} className={`whitespace-pre-wrap ${cls}`}>
                      {ln === "" ? " " : ln}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
