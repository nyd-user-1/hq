import { Section } from "./primitives";

// The "new species of product tool" beat, Linear-style: a two-tone statement (white
// claim → grey elaboration) over a strip and three FIG figures. Linear runs a
// customer logo cloud here; hq has no customers to fake — so the strip is the REAL
// set of sources hq reads (honest, not a fabricated logo wall). The figures are
// abstract isometric line-art, not imagery.

const READS = [
  "~/.claude/projects/**/*.jsonl",
  "memory/*.md",
  "~/.claude/hq/",
  "git log ~/code/*",
  "node:sqlite · FTS5",
];

const FIGS = [
  {
    v: 1 as const,
    n: "FIG 01",
    t: "Reads the disk",
    d: "node:fs over the transcripts, memory, and git logs Claude Code already writes. No daemon, no schema, no ingestion.",
  },
  {
    v: 2 as const,
    n: "FIG 02",
    t: "Steers the session",
    d: "A warm REPL types into the running terminal — no fork, one transcript. Watching turns into control.",
  },
  {
    v: 3 as const,
    n: "FIG 03",
    t: "Zero backend",
    d: "Three runtime deps, full-text search on a built-in, nothing to host. The whole thing runs on localhost.",
  },
];

function FigMark({ v }: { v: 1 | 2 | 3 }) {
  const base = { width: 76, height: 60, viewBox: "0 0 76 60", fill: "none", strokeWidth: 1 } as const;
  if (v === 1) {
    return (
      <svg {...base} stroke="currentColor" className="text-zinc-600" aria-hidden>
        <path d="M38 5 L68 20 L38 35 L8 20 Z" />
        <path d="M38 17 L68 32 L38 47 L8 32 Z" opacity="0.6" />
        <path d="M38 29 L68 44 L38 59 L8 44 Z" opacity="0.35" />
      </svg>
    );
  }
  if (v === 2) {
    return (
      <svg {...base} className="text-zinc-600" aria-hidden>
        <path d="M38 10 L64 25 L38 40 L12 25 Z" stroke="currentColor" />
        <path d="M38 40 L38 55" stroke="#2563eb" />
        <path d="M31 49 l7 7 7 -7" stroke="#2563eb" />
      </svg>
    );
  }
  return (
    <svg {...base} stroke="currentColor" className="text-zinc-600" aria-hidden>
      <path d="M38 14 L64 29 L38 44 L12 29 Z" />
    </svg>
  );
}

export default function Manifesto() {
  return (
    <Section id="manifesto">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-zinc-900 py-5 font-mono text-xs text-zinc-600">
        <span className="text-zinc-500">reads</span>
        {READS.map((r) => (
          <span key={r}>{r}</span>
        ))}
      </div>

      <h2 className="mt-16 max-w-4xl text-4xl font-semibold leading-[1.06] tracking-[-0.02em] text-zinc-50 sm:text-[56px]">
        The disk is the database.{" "}
        <span className="text-zinc-500">
          Purpose-built to read what Claude Code writes — no agent to instrument, no data to pipe. hq sets a new
          bar for watching, costing, and steering agentic sessions.
        </span>
      </h2>

      <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-900 sm:grid-cols-3">
        {FIGS.map((f) => (
          <div key={f.n} className="flex flex-col bg-zinc-950 p-8">
            <FigMark v={f.v} />
            <div className="mt-7 font-mono text-xs tracking-wider text-zinc-600">{f.n}</div>
            <h3 className="mt-3 text-lg font-semibold text-zinc-100">{f.t}</h3>
            <p className="mt-2.5 text-[15px] leading-relaxed text-zinc-400">{f.d}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
