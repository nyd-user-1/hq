import { Section, FileChip } from "./primitives";

const ITEMS = [
  { k: "usage", mono: "$ / tok", t: "Burn you can't see", b: "Dollars vanish mid-session. The bill arrives after the context is gone." },
  { k: "search", mono: "⌕", t: "Work you can't find", b: "Yesterday's fix is trapped in a dead transcript. No recall, ever." },
  { k: "terminal", mono: "⏻", t: "Sessions you can't steer", b: "Agents scatter across repos. No single view, no hand on the wheel." },
];

// One bordered panel split by hairlines into three — a cohesive block, not three
// floating cards. The gap-px-over-a-tinted-background trick draws the dividers.
export default function Problem() {
  return (
    <Section id="problem">
      <FileChip>~/.claude/**</FileChip>
      <h2 className="mt-6 max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-zinc-100 sm:text-5xl">
        Claude Code writes everything to disk. Nobody reads it back.
      </h2>
      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-800 sm:grid-cols-3">
        {ITEMS.map((it) => (
          <div key={it.k} className="flex flex-col bg-zinc-950 p-8">
            <div className="font-mono text-sm text-zinc-600">{it.mono}</div>
            <h3 className="mt-8 text-xl font-semibold text-zinc-100">{it.t}</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">{it.b}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
