import { Section, FileChip } from "./primitives";

// A genuine three-step sequence, so numbered markers earn their place. A hairline
// connector ties the steps on wide screens.
const STEPS = [
  { n: "01", t: "Install once", b: "No account, no config.", cmd: "npm i -g @nysgpt/hq", dim: false },
  { n: "02", t: "Run in a session", b: "One command, inside any repo.", cmd: "hq", dim: false },
  { n: "03", t: "It mirrors live", b: "Pinned as Terminal 1, mirroring every keystroke.", cmd: "→ localhost:3002", dim: true },
];

export default function HowItWorks() {
  return (
    <Section id="how">
      <FileChip>bin/hq</FileChip>
      <h2 className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-zinc-100 sm:text-5xl">
        Live in under a minute.
      </h2>
      <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
        {STEPS.map((s, i) => (
          <div key={s.n} className="relative">
            {i < STEPS.length - 1 && (
              <div aria-hidden className="absolute -right-4 top-2.5 hidden h-px w-8 bg-zinc-800 md:block" />
            )}
            <div className="font-mono text-sm text-blue-400">{s.n}</div>
            <h3 className="mt-4 text-xl font-semibold text-zinc-100">{s.t}</h3>
            <p className="mt-2.5 text-[15px] leading-relaxed text-zinc-400">{s.b}</p>
            <div
              className={`mt-5 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 font-mono text-sm ${
                s.dim ? "text-zinc-500" : "text-zinc-200"
              }`}
            >
              {s.dim ? s.cmd : (
                <>
                  <span className="text-zinc-600">$ </span>
                  {s.cmd}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
