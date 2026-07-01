import { Section, FileChip } from "./primitives";

const BARS = [
  { v: "9", h: 24, c: "#1e3a5f", y: "'24", hi: false },
  { v: "15", h: 42, c: "#1d4ed8", y: "'26", hi: false },
  { v: "22", h: 62, c: "#2563eb", y: "'28", hi: false },
  { v: "30+", h: 100, c: "#60a5fa", y: "'30", hi: true },
];

// Claim on the left, evidence on the right. A plain CSS bar chart — the last bar is
// the one that matters, so it's the only one lit blue.
export default function Market() {
  return (
    <Section id="market">
      <FileChip>the market</FileChip>
      <div className="mt-6 grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-100 sm:text-[42px]">
            Every agentic session is an unobserved process. There are more every day.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-zinc-300">
            Agentic coding went from novelty to daily driver in a year. Every session needs watching,
            costing, steering — and nothing does it.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-zinc-400">
            hq rides the fastest-growing dev workflow of the decade. Fleets of agents make observability
            table stakes.
          </p>
          <div className="mt-7 inline-block border-t border-zinc-800 pt-5 font-mono text-lg text-green-400">
            AI dev tooling → $30B+ by 2030
          </div>
        </div>
        <div>
          <div className="mb-5 font-mono text-xs uppercase tracking-wider text-zinc-500">
            AI dev tooling market · $B
          </div>
          <div className="flex h-72 items-end gap-5 border-b border-zinc-800 sm:h-80">
            {BARS.map((b) => (
              <div key={b.y} className="flex h-full flex-1 flex-col items-center justify-end">
                <div className={`mb-3 font-mono text-sm ${b.hi ? "text-blue-300" : "text-zinc-400"}`}>{b.v}</div>
                <div className="w-full rounded-t-sm" style={{ height: `${b.h}%`, background: b.c }} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-5">
            {BARS.map((b) => (
              <div key={b.y} className="flex-1 text-center font-mono text-xs text-zinc-600">{b.y}</div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
