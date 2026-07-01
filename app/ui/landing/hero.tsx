import Link from "next/link";
import { Ping } from "./primitives";
import TerminalDemo from "./terminal-demo";

// Section 1 — the thesis, shown not told. Linear-grade craft: the wordmark as the
// mark, one tight value headline, one concrete line, two real actions. Right: a
// faithful, LIVE hq terminal running one turn on a loop, so the product IS the hero
// image. Deliberately spare — nothing that isn't load-bearing.
export default function Hero() {
  return (
    <section id="top" className="px-5 sm:px-8">
      <div className="mx-auto grid max-w-6xl items-center gap-10 pb-20 pt-14 sm:pt-20 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div>
          <div className="inline-flex items-center gap-2.5 font-mono text-sm text-zinc-500">
            <Ping /> reading <span className="text-zinc-400">~/.claude</span>
          </div>
          <div className="mt-7 flex items-end gap-2">
            <h1 className="text-[88px] font-semibold leading-[0.78] tracking-[-0.05em] text-zinc-50 sm:text-[128px]">
              hq
            </h1>
            <span
              className="mb-2.5 h-12 w-3 bg-green-500 sm:mb-5 sm:h-[70px] sm:w-4"
              style={{ animation: "hq-cursor 1.1s steps(1) infinite" }}
            />
          </div>
          <h2 className="mt-7 max-w-xl text-4xl font-semibold leading-[1.02] tracking-[-0.02em] text-zinc-50 sm:text-5xl">
            Observability &amp; control for Claude Code.
          </h2>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-zinc-400">
            Every session writes to disk — transcripts, tokens, tool calls, git. hq reads it back
            live, prices every turn, and types straight into the running terminal.{" "}
            <span className="text-zinc-200">No fork. One transcript.</span>
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/?session=new"
              className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              Open hq →
            </Link>
            <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-300">
              <span className="text-zinc-600">$</span> npm i -g <span className="text-green-400">@nysgpt/hq</span>
            </div>
          </div>
          <div className="mt-9 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-900 pt-5 font-mono text-xs text-zinc-600">
            <span>localhost-only</span>
            <span className="text-zinc-800">·</span>
            <span>no DB</span>
            <span className="text-zinc-800">·</span>
            <span>no auth</span>
            <span className="text-zinc-800">·</span>
            <span>3 runtime deps</span>
            <span className="text-zinc-800">·</span>
            <span>open source</span>
          </div>
        </div>

        <div className="lg:pl-2">
          <TerminalDemo />
        </div>
      </div>
    </section>
  );
}
