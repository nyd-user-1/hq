import { Section, FileChip } from "./primitives";

const PATHS = [
  { p: "~/.claude/projects/", d: "**/*.jsonl" },
  { p: "memory/", d: "*.md" },
  { p: "~/.claude/hq/", d: "sidecars" },
  { p: "git log", d: "across ~/code/*" },
];

// The claim, made concrete: the actual paths hq reads, then the writer → reader
// relationship as a small diagram. hq is the highlighted node — the reader.
export default function Insight() {
  return (
    <Section id="insight">
      <FileChip>lib/sessions.ts</FileChip>
      <h2 className="mt-6 max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-zinc-100 sm:text-5xl">
        No agent to instrument. No data to pipe. The disk <span className="text-green-400">is</span> the database.
      </h2>
      <div className="mt-14 grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-7 sm:p-9">
          <div className="font-mono text-xs uppercase tracking-wider text-zinc-500">
            hq reads what Claude Code already wrote
          </div>
          <div className="mt-6 flex flex-col gap-3.5 font-mono text-[15px]">
            {PATHS.map((x) => (
              <div key={x.p} className="flex flex-wrap items-center gap-x-3">
                <span className="text-blue-500">▸</span>
                <span className="text-zinc-200">{x.p}</span>
                <span className="text-zinc-600">{x.d}</span>
              </div>
            ))}
          </div>
          <p className="mt-7 border-t border-zinc-800 pt-6 text-[15px] leading-relaxed text-zinc-400">
            Every feature is <span className="font-mono text-zinc-200">node:fs</span> over paths that already exist.
            No daemon, no schema, no ingestion.
          </p>
        </div>
        <div className="flex flex-col items-center">
          <div className="w-full rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-5 text-center font-mono text-zinc-300">
            Claude Code
            <div className="mt-1 text-xs text-zinc-500">the writer</div>
          </div>
          <div className="py-3 font-mono text-2xl leading-none text-blue-500">↓</div>
          <div className="w-full rounded-xl border-2 border-blue-600 bg-blue-600/[0.08] px-6 py-6 text-center text-2xl font-semibold text-zinc-100">
            hq
            <div className="mt-1 font-mono text-xs font-normal text-blue-300">the reader · localhost:3002</div>
          </div>
        </div>
      </div>
    </Section>
  );
}
