import type { ReactNode } from "react";
import Link from "next/link";
import { Section, FileChip } from "./primitives";

function Feat({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 text-blue-500">✓</span>
      <span>{children}</span>
    </li>
  );
}

// Three tiers, the middle one lifted (border, tint, the wedge tag) because that's the
// business — the power user is the wedge. Every tier ends in one clear action.
export default function Pricing() {
  return (
    <Section id="pricing">
      <FileChip>lib/pricing.ts</FileChip>
      <h2 className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-zinc-100 sm:text-5xl">
        Open-source wedge. Priced for teams.
      </h2>
      <div className="mt-14 grid gap-6 md:grid-cols-3">
        <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8">
          <div className="font-mono text-xs uppercase tracking-wider text-zinc-500">Local core</div>
          <div className="mt-4 text-5xl font-semibold text-zinc-50">$0</div>
          <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">The full command center. Open-source, forever.</p>
          <ul className="mt-6 flex flex-col gap-2.5 text-[15px] text-zinc-300">
            <Feat>Observability &amp; control</Feat>
            <Feat>FTS5 search</Feat>
            <Feat>Single machine</Feat>
          </ul>
          <Link
            href="/?session=new"
            className="mt-8 rounded-lg border border-zinc-700 px-4 py-2.5 text-center text-sm text-zinc-200 transition-colors hover:border-zinc-500"
          >
            Get started
          </Link>
        </div>

        <div className="relative flex flex-col rounded-2xl border-2 border-blue-600 bg-blue-600/[0.06] p-8">
          <span className="absolute -top-3 left-6 rounded-md bg-blue-600 px-3 py-1 font-mono text-xs text-white">the wedge</span>
          <div className="font-mono text-xs uppercase tracking-wider text-blue-300">Power user</div>
          <div className="mt-4 text-5xl font-semibold text-zinc-50">
            $20<span className="text-lg font-normal text-zinc-400">/mo</span>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-zinc-200">For the developer who lives in Claude Code all day.</p>
          <ul className="mt-6 flex flex-col gap-2.5 text-[15px] text-zinc-100">
            <Feat>Cloud sync across machines</Feat>
            <Feat>Team workspaces</Feat>
            <Feat>Shared registries</Feat>
          </ul>
          <Link
            href="/?session=new"
            className="mt-8 rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Start Pro
          </Link>
        </div>

        <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8">
          <div className="font-mono text-xs uppercase tracking-wider text-zinc-500">Fleet</div>
          <div className="mt-4 text-5xl font-semibold text-zinc-50">Custom</div>
          <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">Fleet governance, SSO, deployment support.</p>
          <ul className="mt-6 flex flex-col gap-2.5 text-[15px] text-zinc-300">
            <Feat>SSO &amp; audit</Feat>
            <Feat>Org-wide policies</Feat>
            <Feat>Priority support</Feat>
          </ul>
          <a
            href="mailto:hello@nysgpt.com"
            className="mt-8 rounded-lg border border-zinc-700 px-4 py-2.5 text-center text-sm text-zinc-200 transition-colors hover:border-zinc-500"
          >
            Contact us
          </a>
        </div>
      </div>
    </Section>
  );
}
