"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

// A FAITHFUL, live reproduction of hq's terminal — the landing's signature. Every
// value is lifted from the real thing (app/ui/terminal.tsx + globals.css): the
// dashed boundary + file-path chip, the turn-state border colors (is-active #2563eb,
// is-thinking #f97316 / chip #ea580c, is-done #22c55e / chip #16a34a), the traveling
// conic pulse (hq-border-spin 2.2s), the green activity dot (pulse = writing now),
// the ctx NN% window-left readout, faithful bordered tool-steps, the turn-state
// status line, and the send box. It runs one turn on a loop — active → thinking →
// done — bottom-anchored like a real terminal (newest hugs the send box). Freezes on
// the done state under prefers-reduced-motion.

type Phase = "active" | "thinking" | "done";

const STATE: Record<
  Phase,
  { border: string; chipBg: string; ring?: [string, string] }
> = {
  active: { border: "#2563eb", chipBg: "#2563eb" },
  thinking: { border: "#f97316", chipBg: "#ea580c", ring: ["#fbbf24", "#fb923c"] },
  done: { border: "#22c55e", chipBg: "#16a34a", ring: ["#86efac", "#22c55e"] },
};

function Pulse({ from, to }: { from: string; to: string }) {
  const s: CSSProperties = {
    position: "absolute",
    inset: 0,
    borderRadius: "inherit",
    padding: "1px",
    background: `conic-gradient(from var(--hq-spin), transparent 0deg, ${from} 35deg, ${to} 55deg, transparent 95deg, transparent 360deg)`,
    WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
    WebkitMaskComposite: "xor",
    maskComposite: "exclude",
    animation: "hq-border-spin 2.2s linear infinite",
    pointerEvents: "none",
  };
  return <div data-hq-spin aria-hidden style={s} />;
}

function Step({ busy, done, kind, children }: { busy?: boolean; done?: boolean; kind: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800/80 bg-zinc-900/30 px-2.5 py-1.5 text-[11px]">
      {busy ? (
        <span className="animate-spin text-orange-400" aria-hidden>◐</span>
      ) : done ? (
        <span className="text-emerald-400" aria-hidden>✓</span>
      ) : (
        <span className="text-zinc-600" aria-hidden>›</span>
      )}
      <span className="text-zinc-500">{kind}</span>
      <span className="min-w-0 flex-1 truncate text-zinc-300">{children}</span>
    </div>
  );
}

export default function TerminalDemo() {
  const [phase, setPhase] = useState<Phase>("active");
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  useEffect(() => {
    if (reduce) return;
    const next: Record<Phase, [Phase, number]> = {
      active: ["thinking", 2400],
      thinking: ["done", 4200],
      done: ["active", 3000],
    };
    const [n, ms] = next[phase];
    const t = setTimeout(() => setPhase(n), ms);
    return () => clearTimeout(t);
  }, [phase, reduce]);

  const st = STATE[phase];
  const working = phase === "thinking";
  const done = phase === "done";
  const ctx = working ? 91 : done ? 90 : 92;

  return (
    <div
      className="boundary-flash relative flex flex-col rounded-lg border border-dashed p-4 pt-6 font-mono transition-[border-color] duration-500"
      style={{ borderColor: st.border, background: "#09090b" }}
    >
      <span
        className="absolute -top-2.5 left-4 z-20 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] text-white transition-colors duration-500"
        style={{ background: st.chipBg }}
      >
        <span className="size-1.5 rounded-full bg-white/90" />
        terminal-1
      </span>
      {st.ring && <Pulse from={st.ring[0]} to={st.ring[1]} />}

      {/* header — ● dot · project · session · ctx NN% */}
      <div className="flex items-center gap-2.5 border-b border-zinc-800 pb-2.5 text-[11px]">
        <span
          className={`size-2 rounded-full ${working ? "animate-pulse bg-green-500" : "bg-green-500"}`}
          title={working ? "writing right now" : "active — within the cache window"}
        />
        <span className="text-zinc-300">hq</span>
        <span className="text-zinc-600">·</span>
        <span className="text-green-400">4eb1f98f</span>
        <span className="ml-auto text-zinc-500">
          ctx <span className={ctx <= 30 ? "text-amber-400" : "text-zinc-400"}>{ctx}%</span>
        </span>
      </div>

      {/* transcript — bottom-anchored so the newest line hugs the send box and the
          scrollback space sits above, exactly like a live terminal */}
      <div className="flex min-h-[236px] flex-col justify-end gap-2 py-3 text-[12px] leading-relaxed">
        <div className="text-zinc-300">
          <span className="text-blue-400">you</span> ❯ refactor the auth guard
        </div>
        <Step done kind="READ">guard.ts</Step>
        {phase !== "active" && (
          <Step busy={working} done={done} kind="EDIT">
            guard.ts <span className="text-emerald-400">+12</span> <span className="text-red-400">−4</span>
          </Step>
        )}
        {done && (
          <div className="pt-0.5 text-zinc-400">
            <span className="text-emerald-400">✓</span> Guard early-returns the anonymous case; token check
            runs once.
          </div>
        )}
      </div>

      {/* turn-state status line — the real "Cooking… (…· thinking)" readout */}
      <div className="border-t border-zinc-800/70 py-2 text-[11px]">
        {working ? (
          <span className="text-orange-400">
            <span className="text-orange-400/80">✳</span> Cooking… <span className="text-zinc-500">(0m 6s · ↑ 1.2k tokens · thinking)</span>
          </span>
        ) : done ? (
          <span className="text-emerald-400/90">
            <span className="text-zinc-500">◦</span> done · <span className="text-zinc-500">2.9k tokens · $0.31</span>
          </span>
        ) : (
          <span className="text-zinc-600">◦ idle — waiting on you</span>
        )}
      </div>

      {/* send box — input on top, toolbar row below (the real shape) */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
        <div className="min-h-[18px] text-[12px] text-zinc-200">
          {phase === "active" ? (
            <>
              refactor the auth guard
              <span
                className="ml-0.5 inline-block h-3.5 w-1.5 -translate-y-px bg-blue-500 align-middle"
                style={{ animation: "hq-cursor 1.1s steps(1) infinite" }}
              />
            </>
          ) : (
            <span className="text-zinc-600">— running in the same live session —</span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3 border-t border-zinc-800/80 pt-2 text-[10px] text-zinc-500">
          {working ? (
            <span className="flex items-center gap-1 rounded border border-red-500/40 px-1.5 py-0.5 text-red-300">
              <span className="size-1.5 rounded-sm bg-red-400" /> stop
            </span>
          ) : (
            <>
              <span>+ attach</span>
              <span>+ todo</span>
            </>
          )}
          <span className="ml-auto text-zinc-600">↵ send · ⇧↵ newline</span>
        </div>
      </div>
    </div>
  );
}
