<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# HQ — "Agentic OS"

Product #9. A **localhost-only** observability + control layer over **Claude Code**. No DB, no auth, no deploy, no external services. Three runtime deps total: `next`, `react`, `react-dom`.

The whole idea: **HQ reads the files Claude Code already writes to disk.** Every feature is `node:fs` over `~/.claude/projects/**/*.jsonl` (transcripts), `~/.claude/projects/-Users-…/memory/*.md` (memory notes), `~/vaults/hq/` (the Obsidian vault), and `git log` across `~/code/*`. Claude Code is the writer; HQ is the reader. The disk is the database.

## Run / build / ship

- **Dev:** `npm run dev` → pinned to **:3002**.
- **Build:** ALWAYS `env -u NODE_ENV npm run build`. The Claude shell exports `NODE_ENV=development`, which breaks `next build` (`/_global-error` useContext null). Build before pushing (not `tsc`).
- **Rhythm:** build → commit → push after each change. Remote is `github.com/nyd-user-1/hq` (`main`). Brendan reviews on the live dev server — **don't take verification screenshots while he's watching** (token cost); describe what to look for and he eyeballs.

## Architecture

- **`app/ui/shell.tsx`** (root layout) renders three columns: **SidebarColumn** (left) · **Terminal** (center, mounted ONCE so it never remounts as the panel navigates) · **`#app-panel-root`** portal anchor (right). The terminal is the persistent heart.
- **One parallel-route slot, `@panel`**, rendered into the right column via `PanelWrapper` → `AppPanel` (a portal). Panel width: 360px below `xl`, 420px at `xl`, 46vw when expanded.
- Panel routes live under **route groups**: `(activity)` (Calls · Sessions · To Do), `(metrics)` (Usage & Burn · Savings · Memory Audit), `(console)` (Shipped · Skills · Routines), plus standalone `/search`. Each group's `layout.tsx` draws a `Boundary` with `TabNav` + `FlashOnNav`; each page draws its own inner `Boundary topOnly` (a single dashed top line — `topOnly` drops the box + horizontal padding so content reclaims ~40px; the outer group box keeps it off the panel edge).
- Pages are `export const dynamic = "force-dynamic"` server components that call the `lib/*.ts` readers directly. A few `/api/*` routes exist for client polling: `/api/sessions`, `/api/terminal` (POST a headless `claude --resume <id> -p <prompt>`, DELETE to kill an HQ-spawned run), `/api/terminal/stream` (SSE on file mtime/size), `/api/terminal/turns`, `/api/efficiency`.
- **The "Boundary"** (`app/ui/boundary.tsx`) is the dashed box with a click-to-copy file-path chip on its top border — the on-screen route anatomy. `lead`/`trail` add chips (sidebar toggle, search icon). `topOnly` = top line only.

## lib/ — the engine (all pure node:fs/os/path, zero browser deps)

- `transcript.ts` (the big one) — parses turns + the tool-step timeline, live "working" status, lineage helpers; `turnsFor`, `timelineFor`, `workingStatus`, `sessionFilePath`.
- `usage.ts` — token meter (dedupe by requestId, per-model weighting); `getUsage`, `perFileTotals`, `getSpend` ($).
- `sessions.ts` — session list + metadata + titles + `$` per session.
- `lineage.ts` — the `/clear` chain reconstruction (same-cwd + adjacency heuristic).
- `search.ts` + `archive.ts` + `text-search.ts` — unified Search (see below).
- `pricing.ts` — USD estimates (see Gotchas).
- `efficiency.ts` — Efficiency Mode's measurement.
- `shipped.ts` — `git log` across `~/code/*`; `getShipped`, `getCommit`, `findCommit`.
- `vault.ts` — reads `~/vaults/hq/` (To Do roadmap, etc.).

## Features

- **Search** (`/search`) — the standout. One surface over BOTH corpora: **transcripts** (every session ever, full-text via a persisted ~16MB index at `~/.claude/hq-archive-index.json`, built out-of-process by `scripts/build-search-index.mjs`) and **memory** notes. Card UI with All/Transcripts/Memory filters; result click opens an in-panel reader (transcript turns or the memory note); empty state teaches + has tappable "try" chips. (Archive was merged in and deleted.)
- **Ledger** (Calls panel) — prices usage in **dollars** ($/call, premium 2× flag, session/today/week spend header).
- **Efficiency Mode** — a terminal toggle (default OFF, invisible). ON: quiet money conscience — cliff "bleed" $ + compaction savings $. Measurement only; it CANNOT act on a live session.
- **Shipped** (`/shipped`) — cross-project commit feed; every `~/code` repo covered (each repo's latest always shown). Cards mirror the search cards (sha title · repo · COMMIT badge · message body). Click → the commit's colored diff in the panel. Commit shas inside chat replies are auto-linked (`md.tsx`) to their diff.

## Gotchas

- **Pricing is an ESTIMATE** — published rates centralized in `lib/pricing.ts`; long-context premium modeled as a flat ~2× past the 200k cliff. A decision meter, not an invoice.
- **HARD CEILING:** you canNOT compact/clear/inject a live Claude Code session from outside (no headless `/compact`, no IPC, `-p` is one-shot). Confirmed via docs. So Efficiency Mode measures, doesn't act. True invisible compaction would require HQ to BE the runtime (raw API + compact beta) — the paid pivot.
- **Search index versioning:** `INDEX_VERSION` in `lib/archive.ts` MUST match `VERSION` in `scripts/build-search-index.mjs`. Bump both to force a clean rebuild (incremental reuse keys on mtime, so a logic change like casing would silently persist stale entries).
- **Parallel-route back nav:** a `<Link>` that only STRIPS a searchParam (e.g. `?commit=`) inside the `@panel` slot reuses the cached view (segment unchanged). Use `app/ui/back-link.tsx` (push + `router.refresh()`), or always keep a param like Search does (`?q=&scope=`).
- **Context tier:** Brendan runs the Opus 1M tier; `CONTEXT_LIMIT = 1_000_000` (the transcript can't tell us the tier). 200k = the price cliff marker, not a wall.
- **`useSearchParams` needs a Suspense boundary** or static prerender of `/_not-found` fails.

## Vault join

This repo (`~/code/hq`) ↔ `~/vaults/hq/!hq/`. Design decisions + thread notes live there (`*launchpad/` spine: `002 Roadmap`, `003 Buckets`, `004 Routines`, `005 Honest State & Directions`). The To Do panel reads `*launchpad/002 Roadmap.md` live. Read the latest launchpad note before resuming bigger work.
