"use client";

import { useState } from "react";

// The DEPLOYED face of HQ. HQ reads the local machine's disk (~/.claude, ~/code),
// so a Vercel deploy has no data to show — instead it becomes the install /
// quickstart surface (Neon-CLI-install style). The product still runs locally;
// this page just tells you how to get it.
//   • LandingInstall — the full standalone page (rendered at /install, and, once
//     wired, in place of the shell on a deploy).
//   • InstallCard — a compact, tabbed version rendered inside the terminal's
//     empty-state (the "no session" pane).

const PKG = "@nysgpt/hq";
const REPO = "https://github.com/nyd-user-1/hq";

// A live, glowing status dot — ping ring + solid core + soft emerald glow.
function LiveDot() {
  return (
    <span className="relative flex size-2.5">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]" />
    </span>
  );
}

function CopyIcon({ done }: { done: boolean }) {
  return done ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CopyBlock({ cmd, dashed = false }: { cmd: string; dashed?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(cmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`group flex w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left font-mono text-sm transition-colors ${
        dashed ? "border-dashed" : ""
      } ${
        copied
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-zinc-800 bg-zinc-900/70 hover:border-zinc-700 hover:bg-zinc-900"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="select-none text-zinc-600">$</span>
        <span className={`truncate ${copied ? "text-emerald-300" : "text-zinc-200"}`}>
          {cmd}
        </span>
      </span>
      <span
        className={`flex shrink-0 items-center gap-1.5 text-[11px] uppercase tracking-wide ${
          copied ? "text-emerald-400" : "text-zinc-600 group-hover:text-zinc-400"
        }`}
      >
        <CopyIcon done={copied} />
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}

const TABS: { id: string; label: string; cmd: string }[] = [
  { id: "npm", label: "npm", cmd: `npm i -g ${PKG}` },
  { id: "npx", label: "npx", cmd: `npx ${PKG}` },
  { id: "source", label: "from source", cmd: `git clone ${REPO} && cd hq && npm i` },
];

// Real install tabs — switch method, one command shown at a time.
function InstallTabs() {
  const [active, setActive] = useState("npm");
  const cur = TABS.find((t) => t.id === active) ?? TABS[0];
  return (
    <div>
      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
              active === t.id
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-2">
        <CopyBlock cmd={cur.cmd} dashed />
      </div>
    </div>
  );
}

// Compact, tabbed install card for the terminal's empty-state.
export function InstallCard() {
  return (
    <div className="mx-auto max-w-xl py-8">
      <div className="flex items-center gap-2 font-mono text-xs tracking-wide text-zinc-500">
        <LiveDot />
        HQ — Disk as database
      </div>
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-zinc-100">
        Run HQ on your machine
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
        HQ reads the files Claude&nbsp;Code writes to disk — so it runs locally, not
        here. Install it, then run{" "}
        <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-300">hq</code>{" "}
        inside any Claude&nbsp;Code session.
      </p>
      <div className="mt-5">
        <InstallTabs />
      </div>
      <a
        href="/install"
        className="mt-5 inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
      >
        Full guide &amp; quickstart →
      </a>
    </div>
  );
}

const FEATURES: [string, string][] = [
  ["Terminal mirror", "every Claude Code session, pinned, scrollable, searchable"],
  ["Usage & cost", "tokens and $ per session and per turn — caching savings too"],
  ["Search", "one box over transcripts, memory, notes & scripts"],
  ["Shipped", "a cross-repo commit feed with inline diffs"],
  ["Components", "a live, draggable component registry off your own source"],
  ["Skills & CMD", "discover and run your slash commands"],
  ["Memory Audit", "what loads every session — and what it costs you"],
  ["Compose", "stage @mentions and artifacts, drop them into a terminal"],
];

const STEPS: [string, React.ReactNode][] = [
  ["Install it", <>once, globally — <code className="text-zinc-300">npm i -g {PKG}</code></>],
  ["Run it", <>from inside a Claude Code session: <code className="text-zinc-300">hq</code> (or <code className="text-zinc-300">!hq</code> on your PATH)</>],
  ["It opens", <>HQ launches at <code className="text-zinc-300">localhost:3002</code>, pinned to that session as Terminal&nbsp;1</>],
  ["Keep working", <>HQ mirrors the transcript, tallies tokens &amp; cost, and indexes everything — live, as Claude writes to disk</>],
];

export default function LandingInstall({ embedded = false }: { embedded?: boolean }) {
  return (
    <div
      className={
        embedded
          ? "w-full text-zinc-100"
          : "relative min-h-full w-full overflow-y-auto bg-zinc-950 text-zinc-100"
      }
    >
      {/* soft emerald glow bleeding down from the top (full page only) */}
      {!embedded && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(16,185,129,0.09),transparent)]" />
      )}

      {/* embedded: left-aligned (no mx-auto), no page padding — reads like a
          terminal transcript and rides the terminal's own scroll. */}
      <div
        className={
          embedded
            ? "max-w-2xl pb-6"
            : "relative mx-auto max-w-3xl px-6 py-16 sm:py-24"
        }
      >
        {/* hero */}
        <div className="flex items-center gap-2.5 font-mono text-sm tracking-wide text-zinc-400">
          <LiveDot />
          HQ — Disk as database
        </div>
        <h1 className="mt-6 bg-gradient-to-br from-white to-zinc-400 bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-[2.6rem] sm:leading-[1.1]">
          Observability &amp; control for Claude&nbsp;Code
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-zinc-400">
          A localhost-only dashboard that reads the files Claude&nbsp;Code already writes to
          disk — transcripts, usage, memory, skills, and your git history. No database, no
          auth, no telemetry. <span className="text-zinc-200">The disk is the database.</span>
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-zinc-600">
          <span>localhost-only</span>
          <span className="text-zinc-700">·</span>
          <span>no DB</span>
          <span className="text-zinc-700">·</span>
          <span>no auth</span>
          <span className="text-zinc-700">·</span>
          <span>no deploy</span>
          <span className="text-zinc-700">·</span>
          <span>3 runtime deps</span>
        </div>

        {/* install */}
        <section className="mt-14">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Install
          </h2>
          <p className="mt-3 text-sm text-zinc-400">
            Install globally, then run{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-zinc-300">hq</code>{" "}
            from inside any Claude&nbsp;Code session.
          </p>
          <div className="mt-4 space-y-2">
            <CopyBlock cmd={`npm i -g ${PKG}`} dashed />
            <CopyBlock cmd="hq" dashed />
          </div>

          <p className="mt-8 text-sm text-zinc-500">Prefer not to install? Run it once:</p>
          <div className="mt-3">
            <CopyBlock cmd={`npx ${PKG}`} />
          </div>

          <p className="mt-8 text-sm text-zinc-500">Or from source:</p>
          <div className="mt-3">
            <CopyBlock cmd={`git clone ${REPO} && cd hq && npm i && npm run dev`} />
          </div>
        </section>

        {/* quickstart */}
        <section className="mt-16">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Quickstart
          </h2>
          <ol className="mt-5 space-y-5">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-zinc-700 font-mono text-xs text-zinc-400">
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed text-zinc-400">
                  <span className="font-medium text-zinc-200">{title}</span> — {body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* what's inside */}
        <section className="mt-16">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            What&apos;s inside
          </h2>
          <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {FEATURES.map(([name, desc]) => (
              <div key={name} className="flex gap-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-600" />
                <p className="text-sm leading-relaxed text-zinc-400">
                  <span className="text-zinc-200">{name}</span> — {desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* footer */}
        <footer className="mt-16 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-900 pt-6 text-sm text-zinc-500">
          <a href={REPO} target="_blank" rel="noreferrer" className="transition-colors hover:text-zinc-300">
            github.com/nyd-user-1/hq&nbsp;→
          </a>
          <span className="text-zinc-700">·</span>
          <span>
            Built on Next.js. Reads{" "}
            <code className="text-zinc-400">~/.claude</code>. Runs on your machine.
          </span>
        </footer>
      </div>
    </div>
  );
}
