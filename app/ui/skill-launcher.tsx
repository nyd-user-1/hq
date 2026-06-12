"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Categorized skill launcher: each button fires its slash command into the
// newest session via /api/terminal (claude -p --resume), and the freeform box
// runs any command (with args). Replies land in the Dashboard terminal; a run
// also refreshes Recent Runs below.
const GROUPS: { label: string; skills: string[] }[] = [
  { label: "Review", skills: ["code-review", "verify", "simplify"] },
  { label: "Build", skills: ["run"] },
  { label: "Research", skills: ["deep-research"] },
];

export default function SkillLauncher() {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeform, setFreeform] = useState("");

  async function run(prompt: string, label: string) {
    if (running) return;
    setRunning(label);
    setError(null);
    try {
      // the API refuses implicit targets (001.8 guard) — name the session
      const sessionId = (await (await fetch("/api/terminal/turns")).json())?.id;
      if (!sessionId) {
        setError("no session to target");
        return;
      }
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sessionId }),
      });
      if (!res.ok) setError((await res.text()) || `error ${res.status}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(null);
      router.refresh();
    }
  }

  function submitFreeform() {
    const t = freeform.trim();
    if (!t) return;
    run(t.startsWith("/") ? t : `/${t}`, t);
    setFreeform("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {GROUPS.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
              {g.label}
            </span>
            {g.skills.map((s) => {
              const isRunning = running === `/${s}`;
              return (
                <button
                  key={s}
                  onClick={() => run(`/${s}`, `/${s}`)}
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
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={freeform}
          onChange={(e) => setFreeform(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitFreeform()}
          disabled={running !== null}
          placeholder="/command args — run any skill"
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-40"
        />
        <button
          onClick={submitFreeform}
          disabled={running !== null || !freeform.trim()}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Run
        </button>
      </div>

      {running ? (
        <p className="font-mono text-xs text-zinc-500">
          running <span className="text-orange-300">{running}</span> in the newest
          session — reply lands in the terminal, can take minutes
        </p>
      ) : (
        <p className="text-xs text-zinc-600">
          fires into the newest session via{" "}
          <code className="font-mono text-zinc-400">claude -p</code>
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
