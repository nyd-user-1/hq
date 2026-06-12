"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Routine } from "@/lib/routines";

// Grouping + cadence labels are resolved server-side and passed as plain data,
// so this client module never pulls lib/routines (and its node:fs) into the
// browser bundle. on-demand fires its prompt now; the rest hand off to
// /schedule — both via /api/terminal, landing in the newest session.
export type RoutineGroup = { cadence: string; blurb: string; items: Routine[] };

export default function RoutinePanel({ groups }: { groups: RoutineGroup[] }) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fire(r: Routine) {
    if (running) return;
    setRunning(r.title);
    setError(null);
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: r.dispatch }),
      });
      if (!res.ok) setError((await res.text()) || `error ${res.status}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(null);
      router.refresh();
    }
  }

  if (groups.length === 0) {
    return (
      <p className="text-sm text-zinc-600">
        No routines — add some to{" "}
        <code className="font-mono">!hq/*launchpad/004 Routines.md</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ cadence, blurb, items }) => (
        <div key={cadence} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
              {cadence}
            </span>
            <span className="text-[11px] text-zinc-600">{blurb}</span>
          </div>
          <ul className="flex flex-col gap-2">
            {items.map((r) => {
              const isRunning = running === r.title;
              return (
                <li
                  key={r.title}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-700 px-3 py-2"
                >
                  <span className="text-sm text-zinc-200">{r.title}</span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {r.schedule}
                  </span>
                  <button
                    onClick={() => fire(r)}
                    disabled={running !== null}
                    className={`ml-auto rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                      isRunning
                        ? "border-orange-500/60 bg-orange-500/10 text-orange-300"
                        : r.immediate
                          ? "border-zinc-600 text-zinc-200 hover:border-zinc-400 disabled:opacity-40"
                          : "border-blue-600/50 text-blue-300 hover:bg-blue-600/10 disabled:opacity-40"
                    }`}
                  >
                    {isRunning
                      ? "…"
                      : r.immediate
                        ? "Run now →"
                        : "Schedule →"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {running ? (
        <p className="font-mono text-xs text-zinc-500">
          dispatching <span className="text-orange-300">{running}</span> — reply
          lands in the Dashboard terminal
        </p>
      ) : (
        <p className="text-xs text-zinc-600">
          on-demand runs the prompt now · others hand off to{" "}
          <code className="font-mono text-zinc-400">/schedule</code>
        </p>
      )}
      {error && (
        <p className="whitespace-pre-wrap font-mono text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
