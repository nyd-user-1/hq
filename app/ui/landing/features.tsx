import { Section, FileChip } from "./primitives";

const F = [
  { k: "terminal", t: "Terminal mirror", b: "Every session, pinned and searchable." },
  { k: "api-panel", t: "Usage & cost", b: "Live dollars and token burn, per turn." },
  { k: "search", t: "Search", b: "One box over every transcript, note, and script." },
  { k: "shipped", t: "Shipped", b: "Every commit, every repo, with diffs." },
  { k: "components", t: "Components", b: "A live registry off your own source." },
  { k: "commands", t: "Skills & CMD", b: "Find and fire your slash commands." },
  { k: "audit", t: "Memory Audit", b: "What loads each session — and what it costs." },
  { k: "compose", t: "Compose", b: "Stage @mentions, drop them in a terminal." },
];

// Eight surfaces as one hairline-ruled grid — the same cohesive panel treatment as
// the problem section, so the whole page reads from one hand.
export default function Features() {
  return (
    <Section id="inside">
      <FileChip>app/@panel</FileChip>
      <h2 className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-zinc-100 sm:text-5xl">
        Eight surfaces. One disk.
      </h2>
      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-800 sm:grid-cols-2 lg:grid-cols-4">
        {F.map((f) => (
          <div key={f.k} className="flex flex-col bg-zinc-950 p-7 transition-colors hover:bg-zinc-900/60">
            <div className="font-mono text-xs text-blue-400">{f.k}</div>
            <h3 className="mt-4 text-lg font-semibold text-zinc-100">{f.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.b}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
