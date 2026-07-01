import type { ReactNode } from "react";
import { Section, SectionHead } from "./primitives";
import type { Spec } from "./spec-drawer";

const SPECS: Spec[] = [
  {
    n: "5.1",
    title: "Three dependencies",
    desc: <><span className="font-mono text-zinc-300">next · react · react-dom</span>. The whole stack — no ORM, no state library, no chart library, no auth provider.</>,
    file: "package.json",
  },
  {
    n: "5.2",
    title: "The disk is the database",
    desc: <>Claude Code writes transcripts, tokens, and tool calls to <span className="font-mono text-zinc-300">~/.claude</span>; hq reads them back with <span className="font-mono text-zinc-300">node:fs</span>. Nothing to sync, migrate, or host.</>,
    file: "lib/transcript.ts",
  },
  {
    n: "5.3",
    title: "Localhost-only",
    desc: <>No accounts, so no auth. No server, so no telemetry. Your history never leaves the machine that produced it.</>,
  },
];

const STATS: { n: string; u: string; uc: string; d: ReactNode }[] = [
  { n: "3", u: "deps", uc: "text-green-400", d: <>The whole stack: <span className="font-mono text-zinc-300">next · react · react-dom</span>.</> },
  { n: "0", u: "npm", uc: "text-blue-400", d: <>FTS5 on <span className="font-mono text-zinc-300">node:sqlite</span> — a built-in. Zero added.</> },
  { n: "2", u: "GB", uc: "text-blue-400", d: <>Your entire history, indexed in <span className="text-zinc-300">~8s</span>.</> },
  { n: "0", u: "infra", uc: "text-blue-400", d: <>No host, no auth, no telemetry. Your machine.</> },
];

// Four numbers that ARE the argument. Big Geist figures, mono unit, one line each —
// carried in the same hairline-ruled panel so it belongs to the page.
export default function Moat() {
  return (
    <Section id="moat">
      <SectionHead
        n="5.0"
        name="Moat"
        title="The architecture is the moat."
        desc={
          <>
            Full-text search on <span className="font-mono text-[15px] text-zinc-200">node:sqlite</span> — a runtime
            built-in, zero npm added. Your whole history indexed in seconds, on three dependencies, nothing to host.
          </>
        }
        specs={SPECS}
      />
      <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-800 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.u} className="flex flex-col bg-zinc-950 p-8">
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-semibold tracking-tight text-zinc-50 sm:text-7xl">{s.n}</span>
              <span className={`font-mono text-lg ${s.uc}`}>{s.u}</span>
            </div>
            <p className="mt-6 text-[15px] leading-relaxed text-zinc-400">{s.d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
