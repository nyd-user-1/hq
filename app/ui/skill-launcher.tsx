"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Skill } from "@/lib/skills";

// Skill launcher in the Memory-Audit row aesthetic: clean rows (name ·
// description · right-meta), grouped into YOUR SKILLS (discovered from
// ~/.claude/skills) and BUILT-IN (harness skills, which aren't on disk). Clicking
// a row fires its slash command into the newest session via /api/terminal
// (claude -p --resume); the freeform box runs any command with args. Replies land
// in the Dashboard terminal and a run refreshes Recent Runs below.

// Harness built-ins — not readable from disk, so curated here with descriptions.
const BUILTIN: { cmd: string; cat: string; desc: string }[] = [
  { cmd: "code-review", cat: "review", desc: "Review the current diff for correctness bugs + cleanups" },
  { cmd: "verify", cat: "review", desc: "Run the app and confirm a change actually does what it should" },
  { cmd: "simplify", cat: "review", desc: "Apply reuse / simplification / efficiency cleanups" },
  { cmd: "run", cat: "build", desc: "Launch and drive the app to see a change working" },
  { cmd: "deep-research", cat: "research", desc: "Fan-out, fact-checked, cited multi-source research report" },
];

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

export default function SkillLauncher({ skills }: { skills: Skill[] }) {
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

  // One clean line — /cmd · description (truncates) · right-meta. Mirrors the
  // audit panel's row rhythm; the whole row runs the skill on click.
  const row = (cmd: string, desc: string, meta: ReactNode) => {
    const isRunning = running === `/${cmd}`;
    return (
      <button
        key={cmd}
        onClick={() => run(`/${cmd}`, `/${cmd}`)}
        disabled={running !== null}
        title={desc || `/${cmd}`}
        className="flex w-full items-baseline gap-3 border-b border-zinc-800/60 py-1.5 text-left transition-colors hover:bg-zinc-800/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="shrink-0 font-mono text-xs text-zinc-200">/{cmd}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
          {desc}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-zinc-600">
          {isRunning ? <span className="text-orange-300">running…</span> : meta}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {skills.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            your skills · ~/.claude/skills
          </h2>
          <div className="flex flex-col">
            {skills.map((s) => row(s.name, s.description, `~${fmt(s.tokens)} tok`))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-1">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          built-in
        </h2>
        <div className="flex flex-col">
          {BUILTIN.map((b) => row(b.cmd, b.desc, b.cat.toUpperCase()))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
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
            running <span className="text-orange-300">{running}</span> in the
            newest session — reply lands in the terminal, can take minutes
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
      </section>
    </div>
  );
}
