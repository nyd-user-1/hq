import { Ping } from "./primitives";

export default function Footer() {
  return (
    <footer className="border-t border-zinc-900 px-5 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 font-mono text-sm text-zinc-300">
          <Ping /> hq
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-zinc-500">
          <a href="https://github.com/nyd-user-1/hq" className="transition-colors hover:text-zinc-200">
            github.com/nyd-user-1/hq
          </a>
          <span className="text-zinc-700">·</span>
          <span>
            npm <span className="text-blue-400">@nysgpt/hq</span>
          </span>
          <span className="text-zinc-700">·</span>
          <a href="mailto:hello@nysgpt.com" className="transition-colors hover:text-zinc-200">
            hello@nysgpt.com
          </a>
        </div>
        <div className="font-mono text-xs text-zinc-600">Seed Round · 2026</div>
      </div>
    </footer>
  );
}
