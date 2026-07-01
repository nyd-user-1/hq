import Link from "next/link";
import { Ping } from "./primitives";
import TerminalDemo from "./terminal-demo";

// Section 1 — the thesis, shown not told. Headline-led, Linear's structure: one
// giant value headline (the green block cursor keeps the wordmark's identity),
// one concrete line, two real actions, a mono trust strip — then the product IS
// the hero image: a faithful, LIVE hq terminal running one turn on a loop, wide
// beneath the headline. (The wordmark-led variant lives at 084d458 if we revert.)
export default function Hero() {
  return (
    <section id="top" className="px-5 sm:px-8">
      <div className="mx-auto max-w-6xl pb-20 pt-16 sm:pt-24">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2.5 font-mono text-sm text-zinc-500">
            <Ping /> reading <span className="text-zinc-400">~/.claude</span>
          </div>
          <h1 className="mt-7 text-5xl font-semibold leading-[1.02] tracking-[-0.03em] text-zinc-50 sm:text-7xl">
            Observability &amp; control for Claude&nbsp;Code.
            <span
              aria-hidden
              className="ml-2 inline-block h-[0.8em] w-[0.42em] translate-y-[0.06em] bg-green-500"
              style={{ animation: "hq-cursor 1.1s steps(1) infinite" }}
            />
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
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
          <div className="mt-9 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-zinc-600">
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

        <div className="relative mx-auto mt-16 max-w-4xl">
          <div
            aria-hidden
            className="absolute -inset-x-10 -top-12 bottom-0 -z-10"
            style={{
              background: "radial-gradient(55% 55% at 50% 0%, rgba(37,99,235,0.14), transparent)",
            }}
          />
          <TerminalDemo />
        </div>
      </div>
    </section>
  );
}
