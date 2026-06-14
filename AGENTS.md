<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# HQ — "Agentic OS"

Product #9. A **localhost-only** observability + control layer over **Claude Code**. No DB, no auth, no deploy, no external services. Three runtime deps total: `next`, `react`, `react-dom`.

The whole idea: **HQ reads the files Claude Code already writes to disk.** Every feature is `node:fs` over `~/.claude/projects/**/*.jsonl` (transcripts), `~/.claude/projects/-Users-…/memory/*.md` (memory notes), `~/vaults/hq/` (the Obsidian vault), and `git log` across `~/code/*`. Claude Code is the writer; HQ is the reader. The disk is the database.

## Run / build / ship

- **Dev:** `npm run dev` → pinned to **:3002**.
- **Build:** `npm run build` before pushing (not `tsc`). If it fails with a `/_global-error` "useContext is null" error or a "non-standard NODE_ENV" warning, the shell has `NODE_ENV=development` set — rebuild with `env -u NODE_ENV npm run build` to strip it. That var is NOT always present (it was empty on 2026-06-13), so the `env -u` prefix is a conditional fix, not a mandatory ritual — `echo $NODE_ENV` to check.
- **Rhythm:** build → commit → push after each change. Remote is `github.com/nyd-user-1/hq` (`main`). Brendan reviews on the live dev server — **don't take verification screenshots while he's watching** (token cost); describe what to look for and he eyeballs.

## Architecture

- **`app/ui/shell.tsx`** (root layout) renders three columns: **SidebarColumn** (left) · **Terminal** (center, mounted ONCE so it never remounts as the panel navigates) · **`#app-panel-root`** portal anchor (right). The terminal is the persistent heart.
- **One parallel-route slot, `@panel`**, rendered into the right column via `PanelWrapper` → `AppPanel` (a portal). Panel width: 360px below `xl`, 420px at `xl`, 46vw when expanded.
- Panel routes live under **route groups**: `(activity)` (Sessions · To Do · SDK), `(metrics)` (Usage & Burn · Calls · Savings · Memory Audit), `(console)` (Shipped · Skills · CMD · Routines · Firehose), plus `(compose)` and standalone `/search`. Each group's `layout.tsx` draws a `Boundary` with `TabNav` + `FlashOnNav`; each page draws its own inner `Boundary topOnly` (a single dashed top line — `topOnly` drops the box + horizontal padding so content reclaims ~40px; the outer group box keeps it off the panel edge).
- **Adding a panel tab takes THREE edits, not two** — the group's `layout.tsx` `TabNav`, the page itself, AND `app/ui/sidebar-nav.ts` `PANELS[].routes` (the "is a panel open?" test in `panel-wrapper.tsx`). Miss the registry and clicking the tab *closes the panel*. (`sidebar-nav.ts` is misnamed — panels moved from the sidebar to the terminal's `panels ▾` dropdown; rename pending.)
- **Panel nav must carry the terminal pins.** Any in-panel `<Link>`/`router` nav has to keep `?session`/`?pair` (use `app/ui/keep-pins.ts` `withPins`, or thread them through, as the Search page does). Drop them and the terminal goes unpinned → it self-re-pins via `router.replace`, rebuilding the URL from scratch and **wiping the panel's own params** (this was the "search scope tab snaps back to All" bug). The terminal's sticky re-pin and the run-into-Terminal-1 logic both key off `?session`.
- Pages are `export const dynamic = "force-dynamic"` server components that call the `lib/*.ts` readers directly. A few `/api/*` routes exist for client polling: `/api/sessions`, `/api/terminal` (POST a headless `claude --resume <id> -p <prompt>`, DELETE to kill an HQ-spawned run), `/api/terminal/stream` (SSE on file mtime/size), `/api/terminal/turns`, `/api/efficiency`.
- **The "Boundary"** (`app/ui/boundary.tsx`) is the dashed box with a click-to-copy file-path chip on its top border — the on-screen route anatomy. `lead`/`trail` add chips (sidebar toggle, search icon). `topOnly` = top line only.

## lib/ — the engine (all pure node:fs/os/path, zero browser deps)

- `transcript.ts` (the big one) — parses turns + the tool-step timeline, live "working" status, lineage helpers; `turnsFor`, `timelineFor`, `workingStatus`, `sessionFilePath`.
- `usage.ts` — token meter (dedupe by requestId, per-model weighting); `getUsage`, `perFileTotals`, `getSpend` ($).
- `sessions.ts` — session list + metadata + titles + `$` per session; reads `gitBranch` and merges the Recents sidecar (favorite/hidden/rename).
- `sessions-meta.ts` — Recents view-state sidecar (`~/.claude/hq/sessions-meta.json`): favorite / hidden / custom title, keyed by session id.
- `skills.ts` — discovers the user's skills from `~/.claude/skills/*/SKILL.md` (name + description frontmatter) for the Skills panel.
- `notes.ts` — saved "note blocks" (`~/.claude/hq/notes/*.md`); `saveNote` / `getNotes` / `getNoteFile`.
- `todo.ts` — HQ-native To Do store (`~/.claude/hq/todo.json`). A to-do = title + optional markdown `body` (NO sub-items — the breakdown lives as a markdown list in the body); fields `done`/`createdAt`/`body`/`addedBy`/`fromSession`/`claimedBy`/`category`. Panel (`todo-list.tsx`) = collapsible tool-step-style cards with category filters, drag-to-reorder (All view) + drag-to-terminal (inject), provenance line + session-in-body; new items prepend. Added via the `/todo` skill or the send-box "+ todo" chip (`terminal.tsx todoDraft`); multi-line add splits first-line title / rest body.
- `lineage.ts` — the `/clear` chain reconstruction (same-cwd + adjacency heuristic).
- `search.ts` + `archive.ts` + `text-search.ts` — unified Search (see below).
- `pricing.ts` — USD estimates (see Gotchas).
- `efficiency.ts` — Efficiency Mode's measurement.
- `audit.ts` — Memory Audit reader (the standing context tax) + `readAuditDoc` (guarded `.md` reader for the in-panel viewer).
- `shipped.ts` — `git log` across `~/code/*`; `getShipped`, `getCommit`, `findCommit`.
- `vault.ts` — reads `~/vaults/hq/` (legacy; To Do is HQ-native now).

## Features

- **Search** (`/search`) — the standout. One surface over THREE corpora: **transcripts** (every session ever, full-text via a persisted ~16MB index at `~/.claude/hq-archive-index.json`, built out-of-process by `scripts/build-search-index.mjs`), **memory** notes, and **note blocks** (saved from terminal blocks — see below). Scope chips (All / Transcripts / Memory / Notes) sit ABOVE the input; result click opens an in-panel reader (transcript turns / memory `?open` / note `?openNote`); phrase match is a narrowing tier; a sort toggle flips newest/oldest.
- **Ledger** (Calls panel) — prices usage in **dollars** ($/call, premium 2× flag, session/today/week spend header).
- **Efficiency Mode** — a terminal toggle (default OFF, invisible). ON: quiet money conscience — cliff "bleed" $ + compaction savings $. Measurement only; it CANNOT act on a live session.
- **Shipped** (`/shipped`) — cross-project commit feed; every `~/code` repo covered (each repo's latest always shown). Cards mirror the search cards (sha title · repo · COMMIT badge · message body). Click → the commit's colored diff in the panel. Commit shas inside chat replies are auto-linked (`md.tsx`) to their diff.
- **Skills** (`/skills`) — discovers the user's skills from `~/.claude/skills` (Memory-Audit row aesthetic; an added skill's row opens its `SKILL.md` in-panel via `?open`) plus a curated **BUILT-IN** list (grouped review/build/research/automate/config). A sticky command box runs any `/skill` into **Terminal 1** (the displayed `?session`, snapshotted) via `claude -p`. Provenance dot: blue = your `~/.claude/skills`, orange = built-in.
- **CMD** (`/cmd`) — sibling Console tab listing the ~69 CLI utility slash commands (clear/compact/model/theme/login/…). They can't run via `claude -p` (they drive the live session / a TUI), so the panel is reference + click-to-copy.
- **Recents** (sidebar) — per-session **favorite / hide / rename** behind a `⋮` kebab (sidecar-stored, never written into transcripts); favorites pin to top, hidden filtered with a show-hidden toggle; git branch shows when meaningful.
- **Note blocks** — a per-message-block "save as note" icon next to copy (`NoteButton` in `terminal.tsx`): click → green check + blue border, written as a labeled `.md` under `~/.claude/hq/notes`, and surfaced as the **Notes** corpus in Search. (Saved-state is keyed by block text — survives polling, resets on a full reload.)
- **Memory Audit** (`/audit`) — every row (CLAUDE.md/AGENTS.md/MEMORY.md/memory files) is click-to-open: reads the `.md` in-panel (`?open`, guarded by `readAuditDoc`).
- **Send box** (`terminal.tsx`) — Enter sends (⇧↵ newline, NO send button); textarea auto-grows ~80→200px then scrolls; `+ todo` captures the draft to the HQ To Do list, `+ attach` opens the image picker — both are inline-code chips (the `bg-zinc-800` / `text-violet-300` look from `md.tsx`).

## Gotchas

- **Pricing is an ESTIMATE** — published rates centralized in `lib/pricing.ts`; long-context premium modeled as a flat ~2× past the 200k cliff. A decision meter, not an invoice.
- **HARD CEILING:** you canNOT compact/clear/inject a live Claude Code session from outside (no headless `/compact`, no IPC, `-p` is one-shot). Confirmed via docs. So Efficiency Mode measures, doesn't act. True invisible compaction would require HQ to BE the runtime (raw API + compact beta) — the paid pivot.
- **Search index versioning:** `INDEX_VERSION` in `lib/archive.ts` MUST match `VERSION` in `scripts/build-search-index.mjs`. Bump both to force a clean rebuild (incremental reuse keys on mtime, so a logic change like casing would silently persist stale entries).
- **Parallel-route back nav:** a `<Link>` that only STRIPS a searchParam (e.g. `?commit=`) inside the `@panel` slot reuses the cached view (segment unchanged). Use `app/ui/back-link.tsx` (push + `router.refresh()`), or always keep a param like Search does (`?q=&scope=`).
- **Context tier:** Brendan runs the Opus 1M tier; `CONTEXT_LIMIT = 1_000_000` (the transcript can't tell us the tier). 200k = the price cliff marker, not a wall.
- **`useSearchParams` needs a Suspense boundary** or static prerender of `/_not-found` fails.
- **HQ-native sidecars live under `~/.claude/hq/`** (exists for any Claude Code user, no vault): `todo.json`, `sessions-meta.json`, `notes/*.md`. Same "disk is the database" pattern — and NOT the agent's memory dir.
- **Two terminals share one working tree.** Brendan often runs Terminal 1 (this dashboard's mirror) and Terminal 2 on `~/code/hq` at once. Coordinate via the To Do list's `claimedBy` field; before committing always `git fetch` + `git status` and **stage only your own files** (never `git add -A`); build before push. (T2 owns the To Do panel — collapsible disclosure rows + provenance dots.)

## Vault join

This repo (`~/code/hq`) ↔ `~/vaults/hq/!hq/`. Design decisions + thread notes live there (`*launchpad/` spine: `002 Roadmap`, `003 Buckets`, `004 Routines`, `005 Honest State & Directions`). The To Do panel is now **HQ-native** (`~/.claude/hq/todo.json`) — not the vault (vault optional). Read the latest launchpad note before resuming bigger work.
