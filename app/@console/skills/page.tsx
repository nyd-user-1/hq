"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Boundary from "@/app/ui/boundary";

// Each button fires its slash command into the newest session via the same
// /api/terminal route the Terminal uses (claude -p --resume). The reply lands
// in the transcript, so router.refresh() surfaces it once the run returns.
const SKILLS = ["code-review", "verify", "simplify", "run", "deep-research"];

export default function Skills() {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(skill: string) {
    if (running) return;
    setRunning(skill);
    setError(null);
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `/${skill}` }),
      });
      if (!res.ok) setError((await res.text()) || `error ${res.status}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(null);
      router.refresh();
    }
  }

  return (
    <Boundary label="@console/skills/page.tsx">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {SKILLS.map((s) => {
            const isRunning = running === s;
            return (
              <button
                key={s}
                onClick={() => run(s)}
                disabled={running !== null}
                className={`rounded-md border px-3 py-1.5 font-mono text-sm transition-colors ${
                  isRunning
                    ? "border-orange-500/60 bg-orange-500/10 text-orange-300"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-300"
                }`}
              >
                {isRunning ? `/${s} …` : `/${s}`}
              </button>
            );
          })}
        </div>
        {running ? (
          <p className="font-mono text-xs text-zinc-500">
            running /{running} in the newest session — the reply lands in the
            transcript, can take minutes
          </p>
        ) : (
          <p className="text-xs text-zinc-600">
            fires the slash command into the newest session via{" "}
            <code className="font-mono text-zinc-400">claude -p</code> — output
            appears in the terminal
          </p>
        )}
        {error && (
          <p className="whitespace-pre-wrap font-mono text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    </Boundary>
  );
}
