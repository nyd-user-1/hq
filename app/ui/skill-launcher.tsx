"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Skill } from "@/lib/skills";

// Skills panel body. ADDED SKILLS are discovered from ~/.claude/skills — blue dot,
// row click opens the SKILL.md in-panel (read it). BUILT-IN SKILLS are harness
// skills (no file on disk) — orange dot, row click runs them. The command box at
// top runs any skill. All runs fire into Terminal 1 (the displayed ?session) via
// claude -p; replies land in that terminal.

// Harness built-ins — not readable from disk, so curated here with descriptions.
const BUILTIN: { cmd: string; cat: string; desc: string }[] = [
  { cmd: "code-review", cat: "review", desc: "Review the current diff for correctness bugs + cleanups" },
  { cmd: "verify", cat: "review", desc: "Run the app and confirm a change actually does what it should" },
  { cmd: "simplify", cat: "review", desc: "Apply reuse / simplification / efficiency cleanups" },
  { cmd: "run", cat: "build", desc: "Launch and drive the app to see a change working" },
  { cmd: "deep-research", cat: "research", desc: "Fan-out, fact-checked, cited multi-source research report" },
];

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const ROW =
  "flex w-full items-baseline gap-3 border-b border-zinc-800/60 py-3 text-left transition-colors hover:bg-zinc-800/30";

export default function SkillLauncher({
  skills,
  session,
  pair,
}: {
  skills: Skill[];
  session?: string;
  pair?: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freeform, setFreeform] = useState("");

  async function run(prompt: string, label: string) {
    if (running) return;
    setRunning(label);
    setError(null);
    try {
      // Fire into Terminal 1 (the displayed ?session); fall back to the newest
      // session only if no terminal is pinned.
      const sessionId =
        session || (await (await fetch("/api/terminal/turns")).json())?.id;
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

  // Carry the terminal pins across an in-panel open so the terminal stays put.
  const pinned = (q: string) =>
    [q, session && `session=${session}`, pair && `pair=${pair}`]
      .filter(Boolean)
      .join("&");

  // Row contents: provenance dot · /cmd · description (truncates) · right-meta.
  const inner = (
    cmd: string,
    desc: string,
    meta: ReactNode,
    tone: "blue" | "orange",
    isRunning: boolean
  ) => (
    <>
      <span className="flex shrink-0 items-baseline gap-1.5">
        <span
          className={`text-[10px] leading-none ${
            tone === "blue" ? "text-blue-500" : "text-orange-500"
          }`}
          aria-hidden
        >
          ●
        </span>
        <span className="font-mono text-xs text-zinc-200">/{cmd}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{desc}</span>
      <span className="shrink-0 font-mono text-[11px] text-zinc-600">
        {isRunning ? <span className="text-orange-300">running…</span> : meta}
      </span>
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* command box — at the top, like the search bar on the other panels */}
      <section className="flex flex-col gap-2">
        <input
          value={freeform}
          onChange={(e) => setFreeform(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitFreeform()}
          disabled={running !== null}
          placeholder="/command args — run any skill"
          className="w-full rounded-md border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-40"
        />
        {running ? (
          <p className="font-mono text-xs text-zinc-500">
            running <span className="text-orange-300">{running}</span> in Terminal
            1 — reply lands in the terminal, can take minutes
          </p>
        ) : (
          <p className="text-xs text-zinc-600">
            fires into Terminal 1 via{" "}
            <code className="font-mono text-zinc-400">claude -p</code>
          </p>
        )}
        {error && (
          <p className="whitespace-pre-wrap font-mono text-xs text-red-400">
            {error}
          </p>
        )}
      </section>

      {skills.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            added skills
          </h2>
          <div className="flex flex-col">
            {skills.map((s) => (
              <Link
                key={s.name}
                href={`/skills?${pinned(`open=${encodeURIComponent(s.path)}`)}`}
                scroll={false}
                title={`read ${s.name} SKILL.md`}
                className={ROW}
              >
                {inner(s.name, s.description, `~${fmt(s.tokens)} tok`, "blue", false)}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-1">
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          built-in skills
        </h2>
        <div className="flex flex-col">
          {BUILTIN.map((b) => (
            <button
              key={b.cmd}
              onClick={() => run(`/${b.cmd}`, `/${b.cmd}`)}
              disabled={running !== null}
              title={b.desc}
              className={`${ROW} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {inner(b.cmd, b.desc, b.cat.toUpperCase(), "orange", running === `/${b.cmd}`)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
