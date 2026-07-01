import Link from "next/link";
import { Ping } from "./primitives";

// The thesis. hq's own wordmark is the hero — the most characteristic mark in its
// world. There's no nav bar; the live "reading ~/.claude" status is the top-left
// mark, standing in for a header. One short claim (read/write is the whole pitch),
// then the two real actions: open the app, or copy the install line.
export default function Hero() {
  return (
    <section id="top" className="px-5 sm:px-8">
      <div className="mx-auto max-w-6xl pb-20 pt-12 sm:pt-16">
        <div className="inline-flex items-center gap-2.5 font-mono text-sm text-zinc-500">
          <Ping /> reading <span className="text-zinc-400">~/.claude</span>
        </div>
        <div className="mt-8 flex items-end gap-2 sm:gap-3">
          <h1 className="text-[104px] font-semibold leading-[0.8] tracking-[-0.045em] text-zinc-50 sm:text-[168px]">
            hq
          </h1>
          <span
            className="mb-3.5 h-14 w-3.5 bg-green-500 sm:mb-6 sm:h-24 sm:w-5"
            style={{ animation: "hq-cursor 1.1s steps(1) infinite" }}
          />
        </div>
        <h2 className="mt-5 text-4xl font-semibold leading-[1.0] tracking-tight text-zinc-50 sm:text-6xl">
          Read what Claude writes.
        </h2>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/?session=new"
            className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            Open hq →
          </Link>
          <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-300">
            <span className="text-zinc-600">$</span> npm i -g <span className="text-green-400">@nysgpt/hq</span>
          </div>
          <a
            href="https://github.com/nyd-user-1/hq"
            className="px-3 py-3 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
          >
            GitHub ↗
          </a>
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-900 pt-6 font-mono text-xs text-zinc-600">
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
    </section>
  );
}
