# HQ — Disk as database

An **interactive workspace that replaces the bare terminal** for working with coding
agents — **localhost-only**, built over **Claude Code**. HQ reads the files Claude Code
already writes to disk — transcripts, usage, memory, skills, teams, your git history —
and turns them into a live operator console: sessions in state-colored panels, search
over everything ever run, and real two-way control of the agents themselves. No
database, no auth, no telemetry, no deploy. Three runtime dependencies: `next`,
`react`, `react-dom`.

The whole idea: **Claude Code is the writer; HQ is the reader. The disk is the
database.** And where HQ does act — spawning, driving, approving — it goes through
Claude Code's own front doors, never behind its back.

## Install

```bash
npm i -g @nysgpt/hq
```

Then:

```bash
hq
```

One command, best available surface. On a Mac with the Xcode Command Line Tools,
`hq` builds the **native HQ.app** on first run (self-built — no signing, no
notarization) and opens it in its own window; ⌘B inside the app, or `hq --browser`,
gives you the same HQ in a browser tab. Everywhere else, `hq` serves at
`localhost:3002` and opens the browser. Run it from inside a Claude Code session and
that session pins as Terminal 1.

Run it once without installing:

```bash
npx @nysgpt/hq
```

## What's inside

**The workspace**

- **Terminal, protected center** — every session live, mounted once, never remounted;
  panels orbit it and yield to it
- **State-colored panels** — every panel is a dashed Boundary box wearing its own
  source file as a click-to-copy chip: the UI is its own map
- **Search** — one box over every corpus on disk: transcripts (SQLite FTS5), memory,
  notes, skills, source files. The contract: *if Claude wrote it to disk, it's findable*
- **⌘K palette** — launcher + RRF-fused cross-corpus search; a Finder-style Files
  table over everything Claude ever wrote
- **Components** — a live registry off your own source; drag a card into the terminal
  and it drops the file path into the prompt
- **Shipped** — a cross-repo commit feed with inline diffs; To Do, Notes, Recents

**Drive, don't just watch**

- **Session spawning & driving** — a persistent REPL daemon (outlives the server)
  holds warm `claude` processes; the send box talks to them directly
- **Two-way channels** — a per-session MCP channel server (own loopback port + secret)
  pushes messages into a live session and relays replies and permission prompts back
- **`claude-hq`** — start your session in the terminal *with the channel attached*:
  same TUI, same conversation, but the dashboard can push into it too
- **tmux pane injection** — team agents running as real TUIs are read
  (`capture-pane`) and driven (`send-keys`) in place
- **Teams & mailboxes** — agent-team rosters, the inter-agent mailbox feed, background
  jobs, subagent trees
- **Permission relay & policy** — approve tool calls from the dashboard; a typed
  allow/deny/ask classifier shared by the app and the bare-node daemon

**Cost & governance**

- **Usage & Ledger** — tokens and $ per session and per turn, caching savings
- **Guardrails** — weekly caps and a live $/min burn alarm; HQ is its own OTLP
  receiver, so Claude Code's real telemetry lands with no collector
- **Sweep-or-keep** — HQ owns transcript retention: nothing ages out silently, and a
  swept session stays searchable in the index
- **Memory Audit** — what loads every session, and what it costs you

**The gateway**

- **Backstop** (`packages/backstop`) — a local LLM gateway in the request path from
  session birth: hit your usage limit and flip every live session onto other capacity
  (AWS Bedrock today) mid-conversation, no restart, no lost context. Fail-open by
  contract; the passthrough never inspects a request or response body.

**Ships as**

- one `hq` command with two faces: the native `HQ.app` (a Swift WKWebView shell
  around the bundled server — global hotkey, notes published to Spotlight, launch
  any time from ⌘Space "HQ") on Macs that can build it, and the browser at
  `localhost:3002` everywhere else. `hq --app` / `hq --browser` force either.

## How it works

Every feature is `node:fs` over paths Claude Code already maintains:

- `~/.claude/projects/**/*.jsonl` — transcripts (terminal, search, usage), plus
  `<session>/subagents/` sidechains
- `~/.claude/projects/<home-slug>/memory/*.md` — memory notes
- `~/.claude/teams/` — agent-team rosters and inboxes; `~/.claude/jobs/` — background
  agents
- `~/.claude/hq/` — HQ-native sidecars (To Do, Recents, notes, component order,
  handoffs, guardrail config, OTel cost log)
- `git log` across `~/code/*` — the Shipped feed
- an optional Obsidian vault at `~/vaults/hq/`

Pages are `force-dynamic` server components that call the `lib/*.ts` readers directly;
`/api/*` routes handle client polling and writes.

## packages/

The repo is an npm workspace; each entry under `packages/` publishes on its own and
must never import from the app:

- **`@nysgpt/backstop`** — the gateway's installer/doctor/ejector + daemon
- **`@nysgpt/ui-layer`** — name reserved; not yet extracted

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
