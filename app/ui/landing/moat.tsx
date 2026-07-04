import type { ReactNode } from "react";
import { Section, StackedHead } from "./primitives";
import type { Spec } from "./spec-drawer";

const SPECS: Spec[] = [
  {
    n: "4.1",
    title: "Three dependencies",
    desc: <><span className="font-mono text-zinc-300">next · react · react-dom</span>. The whole stack — no ORM, no state library, no chart library, no auth provider.</>,
    file: "package.json",
  },
  {
    n: "4.2",
    title: "The disk is the database",
    desc: <>Claude Code writes transcripts, tokens, and tool calls to <span className="font-mono text-zinc-300">~/.claude</span>; hq reads them back with <span className="font-mono text-zinc-300">node:fs</span>. Nothing to sync, migrate, or host.</>,
    file: "lib/transcript.ts",
  },
  {
    n: "4.3",
    title: "Localhost-only",
    desc: <>No accounts, so no auth. No server, so no telemetry. Your history never leaves the machine that produced it.</>,
  },
];

// The moat, sold as benefits — a big figure per card, but each carries a plain-English
// headline so the number MEANS something (lean · fast · no-ops · private).
const CARDS: { fig: string; unit?: string; uc: string; head: string; d: ReactNode }[] = [
  {
    fig: "100%",
    unit: "local",
    uc: "text-green-400",
    head: "Your data never leaves.",
    d: <>No accounts, no auth, no telemetry. hq reads your disk on localhost — nothing is ever uploaded.</>,
  },
  {
    fig: "0",
    unit: "infra",
    uc: "text-blue-400",
    head: "Nothing to host.",
    d: <>No server, no database, no cloud bill. Clone the repo and run — <span className="font-mono text-zinc-300">the disk is the database</span>.</>,
  },
  {
    fig: "~8s",
    uc: "text-amber-400",
    head: "Search everything.",
    d: <>Your entire history full-text indexed on <span className="font-mono text-zinc-300">node:sqlite</span> — a runtime built-in, zero npm added.</>,
  },
  {
    fig: "3",
    unit: "deps",
    uc: "text-green-400",
    head: "Audit the whole stack.",
    d: <><span className="font-mono text-zinc-300">next · react · react-dom</span>. No ORM, no state lib, no chart lib — read it in an afternoon.</>,
  },
];

export default function Moat() {
  return (
    <Section id="moat">
      <StackedHead
        n="4.0"
        name="Moat"
        specs={SPECS}
        title="Local first, lightweight, and fast."
        desc={
          <>
            Full-text search on <span className="font-mono text-[15px] text-zinc-200">node:sqlite</span> — a runtime
            built-in, zero npm added. Your whole history indexed in seconds, on three dependencies, nothing to host.
          </>
        }
      />
      <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-800 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <div key={c.head} className="flex flex-col bg-zinc-950 p-8">
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-semibold tracking-tight text-zinc-50 sm:text-7xl">{c.fig}</span>
              {c.unit && <span className={`font-mono text-lg ${c.uc}`}>{c.unit}</span>}
            </div>
            <div className="mt-6 text-[17px] font-semibold text-zinc-100">{c.head}</div>
            <p className="mt-2 text-[14px] leading-relaxed text-zinc-400">{c.d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
