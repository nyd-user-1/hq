import Link from "next/link";
import { Section, FileChip } from "./primitives";

const COLS = [
  { t: "Product", b: "Ship cloud sync, team workspaces, and the Pro tier." },
  { t: "Distribution", b: "Grow the open-source core and developer community." },
  { t: "Runway", b: "18 months to a metered, multi-tier Series A." },
];

// The close: one framed statement (the only place the ask lives), the use of funds,
// and the two actions that matter — open the app, or reach out.
export default function CTA() {
  return (
    <Section id="ask">
      <div className="rounded-2xl border-2 border-blue-600 bg-blue-600/[0.05] p-8 sm:p-14">
        <FileChip>the ask</FileChip>
        <h2 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-zinc-50 sm:text-6xl">
          Raising <span className="text-blue-400">$X</span> to make agent work observable.
        </h2>
        <div className="mt-12 grid max-w-4xl gap-8 md:grid-cols-3">
          {COLS.map((c) => (
            <div key={c.t} className="border-t border-blue-500/20 pt-5">
              <div className="font-mono text-sm text-blue-300">{c.t}</div>
              <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">{c.b}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-3">
          <Link
            href="/?session=new"
            className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Open hq →
          </Link>
          <a
            href="mailto:hello@nysgpt.com"
            className="rounded-lg border border-zinc-700 px-5 py-3 text-sm text-zinc-200 transition-colors hover:border-zinc-500"
          >
            hello@nysgpt.com
          </a>
        </div>
      </div>
    </Section>
  );
}
