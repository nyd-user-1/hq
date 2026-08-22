# HQ — Contributor & Agent Guide

HQ is a **localhost-only workspace over Claude Code**. It reads the files Claude Code
already writes to disk — transcripts, usage, memory, skills, teams — and turns them
into a live operator console. No database, no auth, no telemetry, no deploy. Three
runtime dependencies: `next`, `react`, `react-dom`.

This guide is for anyone — human or coding agent — working on the codebase. It states
the invariants first, because most bad patches here aren't bugs; they're violations of
one of these.

## The invariants

1. **Claude Code is the writer; HQ is the reader.** HQ never writes into Claude Code's
   own files (`~/.claude/projects/**`, `settings.json`, transcripts). HQ-native state
   lives in its own sidecars under `~/.claude/hq/` (todo, notes, session metadata,
   component order). A feature that needs to mutate Claude Code's files is designed
   wrong — find the sidecar shape instead.
2. **The disk is the database.** Every feature is `node:fs` over paths that already
   exist. No copies, no shadow stores, no sync jobs. If a read is slow, cache in
   memory with a short TTL or index it (see Search) — never duplicate the source.
3. **Three runtime deps, forever.** `next`, `react`, `react-dom`. A PR that adds a
   runtime dependency needs an extraordinary reason. Dev-tooling deps are fine.
   Anything under `packages/` ships standalone and may carry its own deps — but must
   never import from the app (`app/`, `lib/`), because `npx` users don't have the repo.
4. **Localhost is a security boundary.** `proxy.ts` rejects non-local requests
   (Origin/Host checks, DNS-rebinding defense). HQ can spawn processes and read the
   whole disk — treat any change to the boundary, the REPL daemon, or the channel
   server as security-sensitive and say so in the PR.
5. **Reads are defensive, per file.** One corrupt transcript, one bad team config, one
   unparseable sidecar must never sink a feature. Parse per-file, catch per-file,
   return what's good.
6. **Search hides nothing.** The contract for every search surface: *if Claude wrote
   it to disk, it's findable.* Recency/size caps are allowed on browse views (and must
   be commented as such); content filters on search are not.

## Repo map

| Path | What it is |
|---|---|
| `app/` | Next.js App Router routes + all UI (`app/ui/*`) |
| `lib/` | The engine: pure `node:fs`/`os`/`path` readers, zero browser deps |
| `bin/` | Launchers: `hq` (dev or packaged), `hq-offline` (standalone), `claude-hq` (channel-attached TUI) |
| `scripts/hooks/` | Claude Code hooks HQ installs (session events, pid capture, statusline) |
| `channel/` | The per-session MCP channel server (own deps, spawned by Claude Code) |
| `packages/backstop` | The local LLM gateway (usage-limit failover). Own package, own tests |
| `packages/ui-layer` | Name reserved, not yet extracted |
| `site/` | The static marketing page (hq.nysgpt.com) — separate from the app |

## Architecture, the parts that bite

- **The terminal is the protected center.** `app/ui/shell.tsx` renders three columns:
  sidebar · terminal · panel portal. The terminal mounts **once** and must never
  remount on navigation. When space is tight, the *panel* yields, never the terminal.
- **Panels are a parallel route** (`@panel`) organized in route groups; standalone
  push-in panels follow the `skills-panel.tsx` pattern (a `<name>-state.tsx` context +
  a portal-mounted `<name>-panel.tsx`). Clone it; don't invent a new shape.
- **Adding a panel tab takes three edits**: the group `layout.tsx` TabNav, the page
  itself, and the `PANELS[].routes` registry in `app/ui/panel-nav.ts`. Miss the
  registry and clicking the tab closes the panel.
- **Carry the pins.** Any in-panel link must preserve `?session`/`?pair` (use
  `withPins` from `app/ui/keep-pins.ts`). Dropping them unpins the terminal, which
  self-re-pins to the newest session and wipes the panel's own params.
- **The Boundary is the design system's spine**: dashed box, click-to-copy file-path
  chip on the top border. Chips display the file name without extension and copy the
  full path. Shared look lives in `CHIP_CLASS` (`boundary-chip.tsx`).
- **The border is the status.** Turn-state colors are fixed vocabulary: blue
  `#2563eb` active · orange `#f97316` thinking · green `#22c55e` done · red `#ef4444`
  stopped. New surfaces reuse these; don't mint new state colors.
- **Component naming**: `[Category][Descriptor][Element]` (`ButtonChipIcon`),
  PascalCase components in kebab-case files. The curated registry is
  `lib/components.ts`.

## Control surface — what HQ can and cannot do to a session

- `claude -p` / `--resume` is **one-shot**: it forks from the on-disk transcript and
  never attaches to a live process. Two processes resuming one session corrupt it.
- Real-time drive of a live session goes through the **channel** (`channel/`): a
  per-session MCP server with its own loopback port + secret, spawned only for
  sessions launched channel-aware (HQ-spawned, or via `claude-hq`).
- Team agents in tmux mode are real TUIs: read with `capture-pane`, drive with
  `send-keys` (`lib/team-tmux.ts`).
- Hooks load at session **init** — a `settings.json` change needs a new session.
- Cost figures are **estimates** (`lib/pricing.ts`) unless the OTLP overlay is active
  (`lib/otel.ts`), and even that carries real token counts with an estimated price.
  Never present either as invoice truth.

## Build & dev workflow

```bash
npm run dev          # dev server, pinned to :3002
npm run build:check  # production build into an ISOLATED .next-build — the pre-push gate
npm run build        # canonical build into .next (CI / packaging; clobbers a live dev server)
```

- **Verify with `build:check`, not `tsc`** — it catches prerender/Suspense errors
  types miss, and it never disturbs a running dev server.
- **Pre-push hook** (`.githooks/pre-push`) runs `build:check` + eslint + a gitleaks
  scan over the exact commit range. One-time setup on a fresh clone:
  `git config core.hooksPath .githooks`.
- Stale-dev-cache symptoms (pages 500 on soft-nav, work on hard refresh):
  `rm -rf .next && npm run dev`.
- The search index version constants must move together: `INDEX_VERSION` in
  `lib/archive.ts` matches `VERSION` in `scripts/build-search-index.mjs`.
- `useSearchParams` needs a Suspense boundary or the build fails on `/_not-found`.

## packages/ — things that ship on their own

Rules for anything published from `packages/`:

- Zero imports from the app. It must run identically from the repo and from `npx`.
- Never hardcode "how to run me" in a message — compute the invocation from how the
  tool was installed, so advice printed months later names a command that exists.
- Shell hooks resolve sibling files from `dirname "$0"`, never from `$HOME` — the
  install location is the only reliable signal of which account owns them.

**Backstop** (the gateway) has a safety contract stricter than the rest of the repo,
because it sits in the request path of every session from birth:

- **Fail-open, always.** A driver that cannot serve resolves `served:false` and leaves
  the response untouched so the request retries on the user's own plan. A driver that
  writes its own error page turns "backstop broke" into "your session broke."
- **The passthrough never inspects a body.** Only backstop-routed traffic is metered,
  and only token counts are kept.
- Its launchd job must live in `~/Library/LaunchAgents`, the daemon runs from its
  install snapshot (never a git worktree), and an unrevivable gateway must disarm
  itself so the next session works.
- `scripts/backstop-selftest.mjs`, `backstop-resilience.mjs`, and
  `backstop-billing-test.mjs` are the gate. Run all three before touching any of it.
  Test against a scratch `CLAUDE_CONFIG_DIR`, never your primary account.

## Contributing

- Small, focused PRs. Build before push (the hook enforces it).
- Comments state constraints the code can't show — not narration, not history.
- No new runtime dependencies; no writes into Claude Code's files; no content filters
  on search. If a change touches the localhost boundary, the daemon, or backstop,
  flag it as security-sensitive in the PR description.
