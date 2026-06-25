<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# HQ — "Agentic OS"

A **localhost-only** observability + control layer over **Claude Code**. No DB, no auth, no deploy, no external services. Three runtime deps total: `next`, `react`, `react-dom`.

The whole idea: **HQ reads the files Claude Code already writes to disk.** Every feature is `node:fs` over `~/.claude/projects/**/*.jsonl` (transcripts), `~/.claude/projects/<home-slug>/memory/*.md` (memory notes), an optional Obsidian vault (`~/vaults/hq/`), and `git log` across `~/code/*`. Claude Code is the writer; HQ is the reader. The disk is the database.

## Run / build / ship

- **Dev:** `npm run dev` → pinned to **:3002**.
- **Build before pushing — use `npm run build:check`** (not `tsc`; a real build catches prerender/Suspense errors `tsc` misses). It builds into an ISOLATED `.next-build` dir (`distDir` is env-gated in `next.config.ts`), so it NEVER clobbers a live `next dev` (which uses `.next`) — run it anytime, no reset, no hard-refresh. If it fails with a `/_global-error` "useContext is null" error or a "non-standard NODE_ENV" warning, the shell has `NODE_ENV=development` set — re-run as `env -u NODE_ENV npm run build:check`. That var is NOT always present (`echo $NODE_ENV` to check).
- **`npm run build` (canonical → `.next`)** is for CI/Vercel + the shipped package build — it shares `.next` with `next dev`, so only run it when no dev server is live, or the dev server then serves STALE output. If you do clobber it: `pkill -f "next dev"; rm -rf .next; npm run dev`, then HARD-refresh ⌘⇧R (a restart doesn't reload an already-open tab). This is the old **"Launchpad Rule"** — now avoidable: prefer `build:check`.
- **Rhythm:** build → commit → push to `origin/main` after each change. A **`pre-push` hook** (`.githooks/pre-push`) enforces `build:check` + `eslint` automatically, so "build before push" can't be skipped by accident — `git push --no-verify` bypasses it in a pinch. Fresh clones enable it once: `git config core.hooksPath .githooks`. Review happens on the live dev server — **avoid spending tokens on verification screenshots**; describe what changed and what to look for instead.

## Architecture

- **`app/ui/shell.tsx`** (root layout) renders three columns: **SidebarColumn** (left) · **Terminal** (center, mounted ONCE so it never remounts as the panel navigates) · **`#app-panel-root`** portal anchor (right). The terminal is the persistent heart.
- **Column sizing — the terminal is the PROTECTED column; the panel yields.** Terminal column = `flex-1 min-w-[380px]` (a floor). `#app-panel-root` + the `AppPanel` box are `min-w-0` (not `shrink-0`) so when the row is tight (sidebar open) the **panel** shrinks, not the terminal. Panel widths are viewport-capped so the terminal stays the larger half: collapsed `min(360px,40vw)` / `min(420px,40vw)` at `xl`; expanded `42vw`. SidebarColumn = `180px` below `xl`, `240px` at `xl+`; Recents rows `flex-wrap` so long ids/names don't truncate.
- **Sidebar open/closed persists** in an `hq-sidebar` cookie, read server-side in `shell.tsx` (`initialOpen`) → a refresh keeps the last state with no flash.
- **One parallel-route slot, `@panel`**, rendered into the right column via `PanelWrapper` → `AppPanel` (a portal).
- Panel routes live under **route groups**: `(activity)` (To Do · Components · Shipped), `(metrics)` (Usage & Burn · Calls · Savings · Memory Audit), `(console)` (Sessions · SDK · Skills · CMD · Routines · Firehose), plus `(compose)` and standalone `/search`. Each group's `layout.tsx` draws a `Boundary` with `TabNav` + `FlashOnNav`; each page draws its own inner `Boundary topOnly bleedX`.
- **Adding a panel tab takes THREE edits, not two** — the group's `layout.tsx` `TabNav`, the page itself, AND `app/ui/panel-nav.ts` `PANELS[].routes` (the "is a panel open?" test in `panel-wrapper.tsx`). Miss the registry and clicking the tab *closes the panel*. (`panel-nav.ts` was `sidebar-nav.ts` — renamed once panels left the sidebar; it's load-bearing: `PanelMenu` reads `PANELS`, `panel-wrapper` reads `PANEL_ROUTES`.)
- **The panels menu is `PanelMenu`** (`app/ui/panel-menu.tsx`) — a **`BoundaryChip` variant** (shares `CHIP_CLASS`; a ▾ marks the menu, the chip labelled `panel-menu.tsx`) sitting on the *terminal* `Boundary` trail (after the `terminal.tsx` path chip, before the `Search` chip), opening Activity/Metrics/Console/Compose. Dashed-bordered menu + an info-circle `ButtonChipIcon` on its top-right; closes on outside click. `SearchTrigger` is the sibling variant (a 🔍 + “Search”).
- **Panel nav must carry the terminal pins.** Any in-panel `<Link>`/`router` nav has to keep `?session`/`?pair` (use `app/ui/keep-pins.ts` `withPins`, or thread them through). Drop them and the terminal goes unpinned → it self-re-pins via `router.replace` to the **newest** session, **switching the session AND wiping the panel's own params** (the "card opens then snaps back" bug). Fixed across shipped/audit/sessions/sdk/savings + chat-reply shas (`CommitLink`). **Deferred (To Do `t_c6cae04f76`):** make the terminal truly chat-stable — option A (persist last pin, restore-not-jump) + B (a single pin-carrying `<PanelLink>`). Until then this rule is whack-a-mole — every new in-panel link MUST carry the pins.
- Pages are `export const dynamic = "force-dynamic"` server components that call the `lib/*.ts` readers directly. A few `/api/*` routes exist for client polling/writes: `/api/sessions`, `/api/terminal` (POST a headless `claude --resume <id> -p <prompt>`, DELETE to kill an HQ-spawned run), `/api/terminal/stream` (SSE), `/api/terminal/turns`, `/api/efficiency`, `/api/todo`, `/api/components` (PUT the registry display order).
- **The "Boundary"** (`app/ui/boundary.tsx`) is the dashed box with a click-to-copy file-path chip on its top border — the on-screen route anatomy. `lead`/`trail` add chips (sidebar toggle, `PanelMenu`, `Search`). **Chip rule:** chips show TRUE casing and DISPLAY the file name with `.tsx` stripped (`terminal.tsx` → `terminal`); the click-to-copy copies the FULL path (extension kept) so it drops into a terminal. `BoundaryChip` strips the extension for display and copies `copyText ?? label` (the send box's chip shows `send-box`, copies `app/ui/terminal.tsx` until SendBox is extracted). Shared look = `CHIP_CLASS` (from `boundary-chip.tsx`). `PanelMenu`/`Search` are action-chip variants (menu / search trigger), not copy chips. `topOnly` = top line only. `bleedX` (topOnly only) negative-margins the line out by the group layout's `px-4/sm:px-5` so the dashed top rule reaches the layout box's side borders, then re-pads the content (layout padding untouched). Opt-in — standalone `/search` and `/compose` aren't in a padded group, so they must NOT set it.

## Components / design system

HQ has a real component library. Naming taxonomy: **`[Category][Descriptor][Element]`** (e.g. `ButtonChipIcon`, `ButtonChipAction`); presentational components stay generic, containers get a `Container`-ish role (`TodoList`/`AppPanel` hold the state). **Files are kebab-case** (`button-chip-icon.tsx`) **and components PascalCase** — no exceptions (the former `PanelMenu.tsx` was renamed to `panel-menu.tsx`).

- **Registry:** `lib/components.ts` — a hand-curated list (`{name,file,kind,status,desc}`); `status` is APPROVED (design-system) vs REVIEW (exists, unaudited). `orderedComponents()` applies a saved order from `~/.claude/hq/components-order.json`; `readComponentSource()` reads each file's source (scoped to `app/ui`).
- **Components panel** (`/components`, Activity) — `ComponentsList`: a search box (`SearchField`) + "Approved" (blue) / "Review" (red) sections of **accordion cards** (`AccordionItem`). Each card: provenance `● claude · file · kind pill`, the name as a draggable label, the component's **source as the body**, a `MetaChipRow` footer (`Component c_… · via session … · at … · Path: …`), a hover copy in the body. Drag a card into a terminal (drops the file path) or onto a sibling to reorder (persists via `PUT /api/components`).
- **Shared primitives:** `AccordionItem` (the generic collapsible card — provenance header, disclosure, drag-to-terminal + reorder; `AccordionTodoItem` is a thin wrapper over it). The **chip family**: `CopyCode`, `BoundaryChip`, `ButtonChipIcon` (icon chip — sidebar toggle / search / panel expand+close all use it), `ButtonChipAction` ("+ label" send-box chips), `MetaChipRow` (labeled copy-chip row), `CommitLink` (chat-reply sha → diff, withPins). `SearchField` (generic controlled search box; `SearchInput` is the route-coupled `/search` one). `todo-categories.ts` holds shared category chips.

## lib/ — the engine (all pure node:fs/os/path, zero browser deps)

- `transcript.ts` (the big one) — turns + tool-step timeline, live "working" status, lineage; `turnsFor`, `timelineFor`, `workingStatus`, `sessionFilePath`.
- `usage.ts` — token meter; `getUsage`, `perFileTotals`, `getSpend` ($).
- `sessions.ts` — session list + metadata + titles + `$`; reads `gitBranch`, merges the Recents sidecar.
- `sessions-meta.ts` — Recents view-state sidecar (`~/.claude/hq/sessions-meta.json`).
- `skills.ts` — discovers `~/.claude/skills/*/SKILL.md`.
- `notes.ts` — saved note blocks (`~/.claude/hq/notes/*.md`).
- `todo.ts` — HQ-native To Do store (`~/.claude/hq/todo.json`). A to-do = title + optional markdown `body`; fields `done`/`createdAt`/`body`/`addedBy`/`fromSession`/`claimedBy`/`category`. Rendered by `AccordionTodoItem` (checkbox is LEADING, before the triangle; no number; copy lives in the body; created-at sits at the end of the `MetaChipRow` as "at <time>"); every to-do is expandable now.
- `components.ts` — the component registry + source reader + order sidecar (see Components above).
- `lineage.ts` — `/clear` chain reconstruction.
- `search.ts` + `archive.ts` + `text-search.ts` — unified Search.
- `pricing.ts` — USD estimates (see Gotchas).
- `efficiency.ts` — Efficiency Mode's measurement.
- `audit.ts` — Memory Audit reader + `readAuditDoc`.
- `shipped.ts` — `git log` across `~/code/*`; `getShipped`, `getCommit`, `findCommit`.
- `vault.ts` — reads `~/vaults/hq/` (legacy; To Do is HQ-native now).

## Features

- **Search** (`/search`) — one surface over THREE corpora: **transcripts** (a prebuilt **SQLite FTS5** index — `lib/sqlite.ts`, built by `scripts/build-search-index.mjs`; sessions newer than the snapshot are live-scanned and merged on top, see `lib/archive.ts`), **memory** notes, and **note blocks**. Scope chips (`flex-wrap`) above the input; click opens an in-panel reader; sort toggle. (Was a ~16MB JSON index at `~/.claude/hq-archive-index.json` through v2 — now dead; that orphan file has been removed.)
- **⌘K command palette** (`command-palette.tsx`) — HQ's primary launcher + search, three scope modes via the chip row: **Menu** (the command launcher — Actions/Navigate, commands only, no corpus hits), **All** (the catch-all full-text search over EVERY corpus via `/api/command-search?scope=all` — RRF-fused, relevance-tiered; empty "All" = a cross-corpus recents feed), **Files** (the macOS-Finder table, `CmdkFilesTable` over `/api/files-all` → `lib/files-index.ts`), then one chip per corpus. A footer `default Menu | All` toggle (localStorage `hq-cmdk-default`) picks the open scope — MENU stays the default so a cold open never loads a large corpus. **The search contract — "if Claude wrote it to disk, it's findable in All. No silent exclusions."** Every corpus reader in `lib/search.ts` surfaces everything by TYPE: MEMORY.md and CLAUDE.md/AGENTS.md (full-text), the component registry, repo source files — none are gated behind their own chip. The Files table is a true Finder over BOTH roots Claude writes to: `~/.claude/**` (transcripts/memory/notes/skills) AND the repo (`app/lib/scripts` + root files). The ONLY permitted limits are recency/perf caps on the *browse* (commits 200/30d, sessions 1000) — never a content filter on *search*, and each is commented as such. We READ what's on disk — no copies, no index bloat. Adding a corpus = add it to `SCOPES` + the `all` fan-out, not a one-off chip.
- **Ledger** (Calls panel) — usage in **dollars**.
- **Efficiency Mode** — terminal toggle (default OFF). Measurement only; CANNOT act on a live session.
- **Shipped** (`/shipped`, now in the **Activity** panel) — cross-project commit feed; every `~/code` repo. Click a card → the commit diff in-panel (the card + back link carry the pins). Diff: lines WRAP (`whitespace-pre-wrap` + hanging indent), Claude-dark `+`/`-` line tints, a `border-zinc-800 pt-3` header rule. Chat-reply shas auto-link via `CommitLink`.
- **Components** (`/components`, Activity) — the component registry (see Components / design system).
- **Skills** (`/skills`) — discovers `~/.claude/skills` + a curated BUILT-IN list; a sticky command box runs any `/skill` into Terminal 1 via `claude -p`.
- **CMD** (`/cmd`) — reference list of the CLI utility slash commands (click-to-copy; can't run via `-p`).
- **Recents** (sidebar) — per-session favorite / hide / rename behind a `⋮` kebab (sidecar-stored).
- **Note blocks** — per-message-block "save as note" → `.md` under `~/.claude/hq/notes`, surfaced as the Notes corpus in Search.
- **Memory Audit** (`/audit`) — every row click-to-open in-panel (`?open`, carries pins).
- **Send box** (`terminal.tsx`) — Claude-chat shape: a textarea on TOP that auto-grows ~1→8 lines then scrolls (bottom-anchored, grows upward; ~124px at rest), over a full-width **toolbar row** (`+ attach` / `+ todo` via `ButtonChipAction`, `stop` when running). Enter sends, ⇧↵ newline, NO send button. Placeholder "Add todo, hit enter" on the To-Do input.
- **Terminal header** — `● project · session · cache · ctx`. `ctx NN%` shows the **% of the 1M window LEFT** (counts down; mirrors the CLI), raw tokens in the hover title.

## Gotchas

- **Pricing is an ESTIMATE** — rates in `lib/pricing.ts`; long-context premium ~2× past the 200k cliff.
- **CONTROL SURFACE (the old "hard ceiling," corrected):** `-p`/`--resume` is one-shot — it forks from the on-disk transcript and NEVER attaches to a live process (two processes on one session interleave + corrupt state). But "you can't act on a live session" is FALSE: a **custom Channel** ([docs](https://code.claude.com/docs/en/channels.md) — an MCP server that pushes events into a running session; research preview, requires the session be launched channel-aware with `--channels`) injects messages in real time, and HQ already fully drives the sessions it spawns (piped stdin on the repl). Still out of reach FROM OUTSIDE: triggering `/compact` or `/clear` (interactive CLI commands, not model-invokable), and retrofitting control onto a plain session already running in someone's terminal (no `--channels` → no push). Hooks (in `settings.json`) can block/modify tool calls + inject context, but load at session INIT — not live-reloaded, so a config change needs a new session. Efficiency Mode measures, doesn't act.
- **Stale dev cache.** Two flavors: (1) `next build` against a live `next dev` clobbers `.next` (see Run/build); (2) pages 500/bounce on soft-nav but work on hard-refresh = corrupted Turbopack cache. Both fix with `rm -rf .next && npm run dev`.
- **Search index versioning:** `INDEX_VERSION` in `lib/archive.ts` MUST match `VERSION` in `scripts/build-search-index.mjs`.
- **Parallel-route back nav:** a `<Link>` that only STRIPS a searchParam inside `@panel` reuses the cached view. Use `app/ui/back-link.tsx` (push + `router.refresh()`), or always keep a param.
- **Pin-carrying (see Architecture)** — every in-panel link must carry `?session`/`?pair`, or the terminal switches sessions + the panel snaps back. Deferred fix in To Do `t_c6cae04f76`.
- **⌘K data-load keying (don't re-couple).** In `command-palette.tsx` each data source is its OWN effect keyed to exactly what it depends on: **Files** (`/api/files-all`) and **Favorites** load on `[open, scope]` — the query filters their rows CLIENT-side, so `q` must never be a dependency; only the **server search** (All + corpus chips → `/api/command-search`) is keyed on `[q, scope]` (debounced + aborted). Collapsing these back into one `[q, scope]` effect makes Files/Favorites refetch + replace hundreds of rows on every keystroke — and the server's 5s read-cache HIDES it (warm ~7ms), so it only shows as client jank. Keep them split.
- **Context tier:** Opus 1M tier; `CONTEXT_LIMIT = 1_000_000`. 200k = the price cliff marker, not a wall.
- **`useSearchParams` needs a Suspense boundary** or `/_not-found` prerender fails.
- **HQ-native sidecars live under `~/.claude/hq/`**: `todo.json`, `sessions-meta.json`, `components-order.json`, `notes/*.md`. NOT the agent's memory dir.
- **Multiple agents may share one working tree.** When they do, coordinate via the To Do `claimedBy` field; `git fetch` + `git status` first, **stage only your own files** (never `git add -A`); build before push.

## Obsidian vault (optional)

HQ can read an Obsidian vault at `~/vaults/hq/` (`lib/vault.ts`) as an **optional** data source — a legacy integration from HQ's origins as a vault reader. It is **not required**: the To Do panel and every core feature are HQ-native (`~/.claude/hq/`, `~/.claude/**`), and when no vault exists those reads simply return empty. (Roadmap: promote this into a first-class, configurable, opt-in connector.)
