# HQ — Disk as database

A **localhost-only** observability + control layer over **Claude Code**. HQ reads the
files Claude Code already writes to disk — transcripts, usage, memory, skills, and your
git history — and turns them into a live dashboard. No database, no auth, no telemetry,
no deploy. Three runtime dependencies: `next`, `react`, `react-dom`.

The whole idea: **Claude Code is the writer; HQ is the reader. The disk is the database.**

## Install

```bash
npm i -g @nysgpt/hq
```

Then, from inside a Claude Code session:

```bash
hq
```

HQ opens at `localhost:3002`, pinned to that session as Terminal 1. Keep working — it
mirrors the transcript, tallies tokens & cost, and indexes everything for search, live.

Run it once without installing:

```bash
npx @nysgpt/hq
```

## What's inside

- **Terminal mirror** — every Claude Code session, pinned, scrollable, searchable
- **Usage & cost** — tokens and $ per session and per turn, plus caching savings
- **Search** — one box over transcripts, memory, notes & scripts
- **Shipped** — a cross-repo commit feed with inline diffs
- **Components** — a live, draggable component registry off your own source
- **Skills & CMD** — discover and run your slash commands
- **Memory Audit** — what loads every session, and what it costs you

## Development

```bash
npm run dev          # dev server on :3002
npm run build:check  # production build into an isolated .next-build (pre-push gate)
npm run build        # canonical build into .next (CI / Vercel / packaging)
```

**Why `build:check`?** `next dev` and `next build` share the `.next` directory, so a
plain `npm run build` against a live dev server clobbers its compiled cache and the dev
server starts serving stale output. `build:check` compiles into a separate `.next-build`
dir (via the `HQ_BUILD_DIR` env in `next.config.ts`), so you can verify a build any time
without disturbing a running dev server. Use it as your build-before-push gate.

## How it works

Every feature is `node:fs` over paths Claude Code already maintains:

- `~/.claude/projects/**/*.jsonl` — transcripts (the terminal mirror, search, usage)
- `~/.claude/projects/<home-slug>/memory/*.md` — memory notes
- `~/.claude/hq/` — HQ-native sidecars (To Do, Recents, notes, component order)
- `git log` across `~/code/*` — the Shipped feed
- an optional Obsidian vault at `~/vaults/hq/`

Pages are `force-dynamic` server components that call the `lib/*.ts` readers directly;
a handful of `/api/*` routes handle client polling and writes. See `AGENTS.md` for the
architecture in depth.
