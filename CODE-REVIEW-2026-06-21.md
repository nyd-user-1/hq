# HQ — Comprehensive Code Review

**Date:** 2026-06-21
**Scope:** Full codebase (`app/`, `lib/`, `scripts/`, `bin/`) — ~25.2k LOC.
**Method:** Five parallel senior reviewers, each read-only, across (1) subprocess/RCE security, (2) file-path security, (3) `lib/` correctness, (4) React client correctness/leaks, (5) server performance — plus a cross-cutting pass on binding/launchers.
**Nothing was modified.** This is a report only — no code, config, or files were changed. (This `.md` is the sole artifact; it is untracked and yours to delete.)

---

## Verdict

The codebase is **well-engineered for its stated design** (localhost-only, no DB, fs-as-database). The team did several hard things right: every subprocess uses `execFile`/`spawn` with **array args (no shell)** — so there is **no classic command injection anywhere**; every `JSON.parse(readFileSync(...))` is `try/catch`-wrapped; named-file readers have sound path-traversal guards; SSE/watcher teardown is genuinely clean (correct `abort` wiring, ref-counted watcher); and the cost math is internally consistent with divide-by-zero guards throughout.

The real risks are **structural, not syntactic**, and cluster in three places:

1. **Security — the "localhost-trusted" premise is not actually enforced.** There is no Origin/Host/CSRF check on *any* route, and the dev server you run every day binds to `0.0.0.0`, not loopback. Together these turn "a process-spawning, arbitrary-file-reading tool" into something a **visited web page or a LAN peer can drive** — the highest-impact category here.
2. **Performance — `force-dynamic` readers re-scan and re-parse very large transcripts synchronously on the request path.** Measured on this machine: **277 transcripts, 1.86 GB, largest single file 326 MB.** Several hot paths `readFileSync` whole multi-hundred-MB files or stat-walk all 277 files per request/keystroke, blocking the event loop.
3. **Correctness — the sidecar write model is last-writer-wins with a torn-write window** that can *wipe* a store (`todo.json`) — and AGENTS.md's own multi-agent guidance makes the race realistic. Plus a surprising one: **per-session cost is always priced as Opus**, overstating every Sonnet/Haiku session 5–15×.

**Counts:** 6 Critical · 10 High · 13 Medium · ~10 Low/Info.

> **Severity legend** — *Critical:* remotely triggerable RCE/data-loss, or event-loop-blocking on the common path. *High:* real exploit/wrong-output/leak under normal use. *Medium:* correctness/perf defect with narrower trigger or lower blast radius. *Low/Info:* hardening, latent, or cosmetic.

---

## Threat model applied

HQ binds (intends to bind) to localhost and has no auth *by design*. The review treats **browser-originating CSRF/DNS-rebinding and LAN reachability as in-scope**, because: (a) HQ spawns `claude` subprocesses that can edit files and run Bash, and (b) it reads arbitrary files and returns them over HTTP. For a tool with those two powers, "localhost-only" is a security boundary that must be *enforced*, not assumed. The Critical/High security findings below are all about that boundary not being enforced.

---

# CRITICAL

### SEC-1 · No CSRF / Origin / Host defense on any route → process-spawning POSTs are drive-by RCE
**Confirmed by two independent reviewers.**
**Location:** `app/api/terminal/route.ts:77` (POST, spawns `claude --resume -p`), `app/api/terminal/repl/route.ts:37` (POST `new`/`start`/`send`), `app/api/todo/evaluate/route.ts:75` (spawns `claude -p`); no `middleware.ts` exists; **no route anywhere reads `origin`/`referer`/`sec-fetch`/`host`**.
**What:** None of the routes that spawn a process — or mutate state (`/api/notes`, `/api/todo`, `/api/sessions-meta`, `/api/components`) — validate that the request is same-origin. They accept a JSON body, which a malicious page can send via `fetch()` to `http://localhost:3002/...`.
**Why it matters:** Any website open in the user's browser while HQ runs can: birth a new HQ-driven `claude` session (in any folder via `body.cwd`), then `send` an arbitrary prompt into it. Read-only Bash + `Read`/`Glob`/`Grep`/`WebFetch` **auto-allow** (`lib/permission-policy.ts:29-35`), so the attacker gets unattended file exfiltration (`Read` any path → `WebFetch` it out) with zero clicks; one human "Approve" on a planted Write/Bash card escalates to full RCE. The browser blocking the *response* read does not stop the *side effect*.
**Fix direction:** Add a `middleware.ts` (or per-route guard) that rejects any request whose `Origin`/`Sec-Fetch-Site` is not same-origin and whose `Host` is not `localhost`/`127.0.0.1:<port>`. This single change closes both CSRF and the DNS-rebinding window and is the highest-leverage fix in this report.

### SEC-2 · `next dev` binds to all interfaces (0.0.0.0), not loopback
**Location:** `package.json` → `"dev": "next dev -p 3002"` (no `-H`); `bin/hq` runs `npm run dev`. (Verified against `node_modules/next/.../next-dev.js` — hostname is left `undefined` → Node listens on all interfaces.) The packaged paths are fine: `bin/hq-offline:48`, `scripts/make-macos-app.sh:98`, `scripts/hq-shell.swift` all set `HOSTNAME=127.0.0.1`.
**What:** The everyday `npm run dev` server is reachable at `http://<your-LAN-IP>:3002`, not only `127.0.0.1`. The "localhost-only" premise is silently false in exactly the mode you actually run.
**Why it matters:** Combined with SEC-1 (no Host check), anyone on the same network — coffee-shop wifi, office LAN, a compromised IoT device — can hit the spawn routes directly, no browser needed. It also widens DNS-rebinding.
**Fix direction:** Pin dev to loopback: `next dev -p 3002 -H 127.0.0.1`. With SEC-1's Host check in place, DNS-rebinding is also closed.

### BUG-1 · Sidecar read-modify-write is last-writer-wins with a torn-write window that can wipe a store
**Location:** `lib/todo.ts:59-62` + all mutators (`addTodo:107`, `updateTodo:133`, `removeTodo:163`, `reorderTodos:183`); same pattern in `lib/sessions-meta.ts:39-41`, `lib/components.ts:114-117`, `lib/plan-config.ts:54-55`, `lib/permission-policy.ts:83`, `lib/repl.ts:30-33`. **Only** `lib/calls.ts:102-104` does it safely (temp-file + `renameSync`).
**What:** Every sidecar except `calls-index.json` does `read() → mutate in memory → writeFileSync(STORE)` directly onto the destination — no lock, no atomic temp-then-rename.
**Why it matters:** Two reachable failures, and AGENTS.md *itself* documents multiple agents sharing one tree, while `todo.json` is written from both the UI and Claude's `/todo`:
- **Lost update:** A and B read the same snapshot, A writes, B writes → A's change silently gone (`addTodo` rewrites the whole file, so a concurrent add drops a to-do).
- **Torn read → permanent loss:** `writeFileSync` is non-atomic; a reader opening mid-write sees truncated JSON → the `catch` returns `{items:[]}` → the **next writer starts from empty and overwrites the entire store with `[]`**. The graceful catch converts a transient torn read into permanent data loss.
**Fix direction:** Port `calls.ts`'s temp-file-then-`renameSync` to every sidecar writer (atomic on the same fs → readers never see partial; a crash never truncates). The rename fixes corruption but not the cross-request lost update — add a coarse in-process async mutex per sidecar (all routes run in one Next process).

### PERF-1 · `force-dynamic` readers re-`readdirSync` + `statSync` all 277 transcripts per request, uncached
**Location:** `lib/transcript.ts:23-55` (`allSessions`), `lib/sessions.ts:234-266` & `376-403`, `lib/usage.ts:141-164`, `lib/calls.ts:164-184`, `lib/archive.ts:42-71`.
**What:** Each does a synchronous nested dir walk (`readdirSync` × 28 dirs + `statSync` per `.jsonl`) with no memoization. `allSessions()` is called by `findSessionFile`, `latestSessionId`, **and** `streamSignature(unpinned)` — so one `/api/terminal/turns` request can trigger the full ~305-syscall walk several times.
**Why it matters:** Blocks the event loop on every request. Worse, `streamSignature(null)` runs the full walk inside the **always-open terminal SSE backstop** and on every watcher tick — so with firehose + terminal + sidebar streaming, these walks stack and contend.
**Fix direction:** One short-TTL (~1–2s) module-level cache of `{file, mtime}[]`, shared by all readers — one walk per tick, not one-per-reader-per-request.

### PERF-2 · Polled tail reads (`turnsFor`/`workingStatus`/`sessionCwd`/`lastTurnInterrupted`) re-read+parse an 8 MB tail per poll, uncached — active file up to 326 MB
**Location:** `lib/transcript.ts:16` (`TAIL_BYTES = 8 MB`), `140-163`, `459-487`, `638-651`, `698-711`.
**What:** The non-`full` path `readSync`s the last 8 MB, decodes UTF-8, splits, and `JSON.parse`s every line — on every poll. The terminal refetches turns on every SSE `change` (~every 150 ms during a live turn). Four separate functions each independently re-read overlapping tails of the *same* file for one logical "what's happening now" query. The `full` path caches by mtime; **the tail path does not.**
**Why it matters:** 8 MB read + decode + per-line parse is tens of ms of event-loop CPU, repeated multiple times per second during active work, against files that are routinely 100–326 MB here.
**Fix direction:** Cache the parsed tail by `(file, mtime, size)` so a no-change poll is free; use a much smaller tail for `sessionCwd`/`lastTurnInterrupted` (they need the last few lines, not 8 MB); coalesce the four reads behind one parse.

### PERF-3 · Search live-scan `readFileSync`s entire transcripts (up to 326 MB) per keystroke
**Location:** `lib/archive.ts:186-214` (`liveEntry`, `fs.readFileSync(file,"utf8")`), from `searchTranscriptIndex:279-286`.
**What:** After the FTS5 candidate query, any file with `mtime > builtMaxMtime` is **fully `readFileSync` + parsed + normalized**. It's cached by `(file, mtime)` — but the active session's mtime changes every turn, so the cache misses exactly when you're searching mid-session. `/api/search` and `/api/command-search` call this on a debounced keystroke.
**Why it matters:** A 326 MB `readFileSync` is a hard multi-hundred-ms-to-second event-loop block plus a large transient heap spike — triggered per keystroke whenever the active transcript is newer than the last index build.
**Fix direction:** Cap the live-scan to a tail (`openSync`+`readSync`) like the rest of `transcript.ts`, or skip live-scanning files above a size threshold and rely on the next incremental index build; bound how many newer-than-index files get full-read per query.

---

# HIGH

### SEC-3 · Path traversal → arbitrary `*.jsonl` file read via `sessionFilePath` fallback
**Location:** `lib/transcript.ts:85-87`, reached from `app/api/search-content/route.ts:33`, `app/api/terminal/turns/route.ts:19,36`, `app/api/efficiency/route.ts:9-10`, `lib/firehose.ts:132` (via `/api/firehose/stream`).
**What:** `sessionFilePath(id) = findSessionFile(id) ?? path.join(SESSIONS_DIR, \`${id}.jsonl\`)`. The fallback concatenates raw, unvalidated `id`; no route validates it as a UUID. `id = "../../../../etc/foo"` → reads any file on disk **ending in `.jsonl`**. `/api/terminal/turns` (`timelineFor`) and `sessionCwd` surface raw line content.
**Why it matters:** A browser-originated GET (via SEC-1) reads any `*.jsonl` on the machine — other projects' transcripts, any attacker-plantable `.jsonl`.
**Fix direction:** Validate `id` against a strict session-id shape at the top of `sessionFilePath` (or per route) and return null/400; or drop the concatenation fallback and only return paths `findSessionFile` actually found.

### SEC-4 · REPL `new` spawns a session in an attacker-chosen directory (no allowlist)
**Location:** `app/api/terminal/repl/route.ts:54-57` → `expandHome(body.cwd)` → `startNewSession` → `lib/repl.ts:156,219`.
**What:** `body.cwd` is `~`-expanded (no traversal stripping) and used as the spawn `cwd` after only an existence/isDirectory check — no restriction to `~/code`/projects root. Can be `/`, another repo, a git repo with hostile hooks. (The `newProject` name *is* sanitized; the `cwd` path is not.)
**Why it matters:** Chained with SEC-1/SEC-2, the attacker chooses *where* the driven session runs — point it at a repo with a malicious `.git/hooks/post-checkout` or poisoned `CLAUDE.md`/`.claude/settings.json` and even auto-allowed `git status` becomes code execution in that trust context.
**Fix direction:** Constrain `body.cwd` to resolve (after `realpath`) under an allowlist (`projectsRoot()`/`~/code`/`defaultWorkspace()`); reject anything outside.

### SEC-5 · Permission classifier is verb-prefix matching, not a shell parser — chained commands bypass it
**Location:** `lib/permission-policy.ts:104-133`, default patterns `:30-35`; the limitation is asserted by `lib/permission-policy.test.mts:73-80`.
**What:** `allowBashPatterns` are prefix regexes (`^(ls|cat|echo|…)\b`). `echo hi; rm -rf x` matches `^echo\b` and is **auto-allowed** with no operator prompt (the test asserts this as current behavior). `find … -exec`, `$(...)`/backticks inside an allowed verb's args, `cat $(curl evil)` all slip through. `find`/`sed`/`awk`/`env` in the allowlist are independently dangerous.
**Why it matters:** This is the *only* gate between a driven session and arbitrary shell. With SEC-1, an attacker who can `send` a prompt just needs the model to emit a Bash call starting with an allowed verb to get unattended arbitrary command execution. Even single-user, prompt-injected `WebFetch` content could coax it.
**Fix direction:** Treat any command containing shell metacharacters (`;`, `|`, `&`, `$(`, backtick, `>`, newline) as `ask` regardless of prefix; drop/constrain `find`/`sed`/`awk`/`env` from auto-allow; ideally tokenize and match full argv.

### BUG-2 · Per-session cost is always priced as Opus, regardless of the session's real model
**Location:** `lib/usage.ts:346-360` (`perFileTotals` returns model-less totals) → `lib/sessions.ts:423-430` calls `baseCost(...)` with **no model** → `lib/pricing.ts:32-36` defaults unknown model to `RATES[0]` = Opus ($15/$75).
**What:** `perFileTotals()` drops the model, so `getSessions()` can't pass one, and pricing defaults to Opus.
**Why it matters:** Every Sonnet session's cost is overstated ~5× (input $15 vs $3), every Haiku ~15×. The Sessions panel's per-session dollar figure is systematically wrong for any non-Opus session — and it **disagrees with `getSpend`**, which prices per-record with the real `r.model`. Two cost surfaces, two answers.
**Fix direction:** Track a dominant/most-recent model per file in `perFileTotals` (or split totals by model) and thread it into `baseCost`; or explicitly document per-session cost as an Opus-rate ceiling.

### BUG-3 · `efficiency.ts` dedupe is adjacency-only → double-counts the "$ bled" headline
**Location:** `lib/efficiency.ts:97-100`.
**What:** It collapses a streaming partial only when its message id equals the *immediately preceding* record's (`mid === lastId`). `usage.ts`/`calls.ts` dedupe via a `Map` keyed by id regardless of position. Any interleaving (a sidechain/tool_result line between two partials of one assistant message) breaks adjacency → the message counts twice.
**Why it matters:** `bledTotal` (the headline "$ bled past the cliff") can double-count, and the duplicate perturbs `prevContext`, skewing compaction-drop detection.
**Fix direction:** Switch to a `Map<id, rec>` dedupe (update in place to preserve drop-detection order).

### FE-1 · `loadTurns` has no abort/sequence guard → overlapping fetches, last-writer-wins, session-switch race
**Location:** `app/ui/terminal.tsx:1036-1098` (`loadTurns`), consumed at `1281-1288`, `1299-1300`, and the 1 s working-tick `1312-1320`.
**What:** During a live turn, an SSE `change` + the 1 s tick + a reconnect `ready` can each fire `loadTurns()` in the same second — full `/api/terminal/turns` fetches with **no in-flight guard**; a slow earlier response lands last and wins. On session switch (`pinned` changes), an in-flight fetch for the *previous* session still runs `setItems`/`setResolvedId` into shared state. (Note: this is *not* a per-render EventSource reconnect — the SSE teardown is correctly keyed to session change; the defect is the unguarded overlapping fetches.)
**Why it matters:** Visible flicker of the "working" line and token count during active turns; fast Recents switching can momentarily show the previous session's transcript or leave a stale `resolvedId` that drives a wrong re-pin.
**Fix direction:** Add an `AbortController` + "is this still the current request?" guard inside `loadTurns` (abort the prior fetch; ignore a response if a newer request started, or if `pinned` no longer matches) — the same pattern `api-panel.tsx`/`command-palette.tsx` already use correctly.

### FE-2 · `items` array grows unbounded in the mounted-once terminal
**Location:** `app/ui/terminal.tsx:733` (state), replaced/appended at `1063`, `1546`, `1573`, `1605`, `1653`, `1683`.
**What:** The terminal mounts once and lives the whole session. Once the user scrolls to top, `expandedRef` makes every poll request `full=1` — so from then on **every 1 s tick and every SSE change re-fetches and holds the entire transcript** in `items`, plus optimistic sends. No cap.
**Why it matters:** On a multi-hour session the always-mounted terminal holds the full parsed turn list and re-renders it every tick; memory and render cost climb monotonically until a hard refresh.
**Fix direction:** Cap in-memory `items` to a tail window unless explicitly expanded; or virtualize the list; or stop forcing `full=1` on every poll once expanded (re-collapse when the user returns to the bottom).

### PERF-4 · Calls reads parse all transcripts and synchronously rewrite the whole index on a read path
**Location:** `lib/calls.ts:186-212` (`refreshCache`), `95-108` (`saveSidecar`), `263-284`.
**What:** `refreshCache` walks all 277 files and, if anything changed, `saveSidecar()` serializes the **entire** 33k+-call record map to JSON and `writeFileSync`s it synchronously. `getCall(id)` (the drill-down, on the pin-carrying nav hot path) calls `refreshCache()` first — so opening one call detail can trigger a full re-walk + a multi-MB synchronous write if any active session grew.
**Why it matters:** Synchronous large-JSON `writeFileSync` on the event loop, triggered by a *read*.
**Fix direction:** Debounce/throttle `saveSidecar` (no need to persist per appended line); have `getCall` refresh only the one file it needs (or accept slightly stale data for a detail view).

### PERF-5 · `getUsageStates()` refreshes the whole transcript cache 3× per `/api/usage` request
**Confirmed by two reviewers (perf + correctness).**
**Location:** `lib/usage.ts:537` + `getForecast()` (`:377`) + `getSpend()` (`:227`), all called per `getUsageStates`.
**What:** Three full incremental re-scans (each a stat-walk of all dirs) per usage request. Plus `getSessions()` calls `getUsage()`→`refreshCache()` and its own separate walk.
**Why it matters:** The most-polled endpoint triples its directory-walk + traversal cost per hit.
**Fix direction:** Make `refreshCache()` idempotent-per-tick (skip if refreshed <500 ms ago) so the nested calls collapse to one; same guard helps `calls.ts`.

### PERF-6 · Shipped page shells `git log` synchronously across every `~/code` repo
**Location:** `lib/shipped.ts:28-96` (`getShipped`, `execFileSync` per repo), `141-157` (`findCommit`).
**What:** `readdirSync(~/code)` then per repo a **synchronous** `execFileSync("git log", … , timeout 4000)`. A 5 s TTL cache absorbs bursts, but the first/expired call fans out N serial blocking spawns. `findCommit` is worse — loops every repo calling `getCommit` (another `execFileSync`) until a match, **uncached**, on every chat-reply sha click.
**Why it matters:** N serial process spawns block the event loop; a slow/large repo can burn its 4 s timeout with the whole server stalled.
**Fix direction:** Use async `execFile` + `Promise.all` across repos (the page is already async); cache or parallelize `findCommit`.

---

# MEDIUM

### SEC-6 · `readAuditDoc` reads any `*.md` under `$HOME`, not just the audit set
**Location:** `lib/audit.ts:52-61`. Guard is `resolved === HOME || resolved.startsWith(HOME + sep)` + `.endsWith(".md")` — far wider than memory/audit files. Via SEC-1, `?open=/Users/<you>/private/notes.md` (any `.md` under `$HOME`) is readable. **Fix:** constrain to `MEMORY_DIR` / `~/.claude/CLAUDE.md` / `~/code/<dir>/{CLAUDE,AGENTS}.md`.

### SEC-7 · DELETE `/api/terminal` is CSRF-reachable (DoS only; arbitrary-PID kill is *not* possible)
**Location:** `app/api/terminal/route.ts:159-171`. Kills only children in the in-memory `running` Map (looks up the `ChildProcess`, never a caller PID) — so no arbitrary-PID kill. The issue is the shared missing-Origin root cause (SEC-1): a page can terminate in-flight HQ runs. **Fix:** covered by SEC-1's middleware.

### BUG-4 · Tail-read off-by-one drops a complete first line on an exact newline boundary
**Location:** `lib/transcript.ts:113` and the same `partial = startAt > 0` pattern in `turnsFor:151`, `timelineFor:295-307`, `efficiency.ts:59-71`, `firehose.ts:135-151`, `sessions.ts:51`. When `startAt` lands exactly on a `\n`, the first (whole) line is still discarded. Rare; affects only the oldest visible item. **Fix:** only shift when the byte before `startAt` isn't a newline.

### BUG-5 · `sessionBlock()` 5-hour grid drifts an hour across DST
**Location:** `lib/usage.ts:208-214`. `setHours(5,…)` is wall-clock but the grid steps in fixed `BLOCK_MS`; on 23h/25h DST days the "resets at 5am" anchor drifts an hour. The meter is a calibrated estimate, so impact is minor. **Fix:** anchor in UTC or account for the offset.

### BUG-6 · `fmtUSD` renders genuine micro-costs as a zero-looking `$0.000`
**Location:** `lib/pricing.ts:101-106`. `0.0004 → "$0.000"` reads as free on a money meter. **Fix:** add a `< $0.001 → "<$0.001"` branch.

### BUG-7 · `recentCommands` caps source breadth at 8 files regardless of `limit`
**Location:** `lib/transcript.ts:760` (`files.slice(0,8)`) vs the `limit` param. "Show last 20 commands" silently returns fewer with no signal. **Fix:** scan `Math.max(8, limit)` files, or document the cap.

### FE-3 · Left-in debug `console.log` + module-global mount counter
**Location:** `app/ui/terminal.tsx:201` (`let mountCount = 0`), `1014-1017` (logs `[terminal] mounted — count=N` on every mount). Harmless but a shipped debug probe; `mountCount` survives Fast Refresh and only grows. **Fix:** remove, or gate behind a debug flag.

### FE-4 · `useRepl` teardown doesn't tell the backend to stop → orphaned driven REPL
**Location:** `app/ui/use-repl.ts:67-126`. Cleanup closes the client `EventSource` but never issues `post({action:"stop"})`; if drive is toggled off (or session switched) fast, the warm process keeps running server-side with no client attached. AGENTS.md notes orphan processes were a past bug. **Fix:** on cleanup, if a `start` was issued, also fire `stop` (or add a server-side idle reaper).

### FE-5 · Esc-handler rebinds a `window` keydown listener on *every* render
**Location:** `app/ui/terminal.tsx:1393-1415` (intentional "no dep array"). Not a leak (cleanup is correct), but add/remove a global listener many times per second during a live turn and on every keystroke — needless churn on the hottest component. **Fix:** bind once with `[]` deps and read `sending`/`working`/`escArmed` from refs.

### FE-6 · `coldFlash` one-shot is coupled to the `now` tick — brittle
**Location:** `app/ui/terminal.tsx:1349-1368`. The fade timers live in a `now`-keyed effect; it works only because the 1 s interval stops at the right moment. If the idle 30 s tick fires inside the 5 s flash window it can clear the in-progress timers and the flash sticks or vanishes early. **Fix:** move the one-shot into its own effect keyed on a derived `isCold` boolean.

### PERF-7 · `firehoseFor` re-reads + parses a 2 MB tail per refresh, uncached
**Location:** `lib/firehose.ts:10,123-257`. Every firehose SSE `change` (~1/800 ms during a live turn) re-reads + re-parses the 2 MB tail from scratch; no `(file, mtime)` cache. (Item array *is* capped at 600, so memory is bounded.) **Fix:** cache the parsed result by `(file, mtime)`.

### PERF-8 · `events.ts` cache grows unbounded and is fully copied+sorted per read
**Location:** `lib/events.ts:209-368`. `cachedEvents` is append-only and never trimmed; every reader does `[...cachedEvents].sort(...)` — a full copy + O(n log n) per call, and `/api/events` does **three** per request. Events are low-volume, so growth is slow. **Fix:** maintain newest-first incrementally (events arrive in order — prepend, don't re-sort) and cap retained in-memory events.

### DOC-1 · Stale 18.5 MB orphan index on disk; AGENTS.md documents a dead JSON index
**Location:** `~/.claude/hq-archive-index.json` (18.5 MB) — **zero code references** (grepped `lib`/`app`/`scripts`). The code migrated to SQLite FTS5 (`INDEX_VERSION=3`, "was a JSON file through v2"); `lib/sqlite.ts` caches a read-only handle by mtime and reopens on rebuild — correct. So AGENTS.md's "persisted ~16MB index … read+JSON.parsed on every keystroke" is **no longer true**. **Fix:** delete the orphan file; update AGENTS.md to describe the SQLite FTS5 path.

---

# LOW / INFO

- **SEC-8 (Low, latent):** `lib/vault.ts:97-105` `getNote(relPath)` has an **unguarded** `path.join(VAULT_ROOT, relPath)` — `../../etc/passwd` escapes with no suffix constraint. Currently **no callers** (only `latestHandoff` is imported), so not exploitable — but a loaded gun. **Fix:** delete the dead export or add a `resolve`+`startsWith(VAULT_ROOT+sep)` guard now.
- **SEC-9 (Low):** Sidecar/notes writers accept **unbounded, unvalidated content** (no length cap on `POST /api/notes`/`/api/todo`); `saveNote` interpolates frontmatter (`role`/`project`/`sessionId`/`at`) into YAML-ish lines without escaping, so a value with a newline can inject extra frontmatter keys that other readers (`latestHandoff`) key off. Via SEC-1, a page can spam/disk-fill these stores. **Fix:** cap input lengths; strip newlines / quote interpolated frontmatter values.
- **COV-1 (Low):** Subagent transcripts (`…/<session>/subagents/agent-*.jsonl`, present on disk) are **missed by the one-level dir walkers** (`transcript.ts:34-40`, `sessions.ts:252`, `calls.ts:177-181`, `build-search-index.mjs:141`) but **caught by the recursive `fs.watch`** (`watcher.ts:54`) — so subagent writes trigger SSE refreshes for data no reader can see, and subagent token burn is unmetered/unsearchable. **Fix:** make readers and watcher agree (recurse into `subagents/`, or document the exclusion).
- **FE-7 (Low):** `RefreshOnChange` (`app/ui/refresh-on-change.tsx:17-24`) fires `router.refresh()` per SSE `change` with no debounce → a write storm becomes a burst of full RSC refreshes. **Fix:** trailing debounce ~250 ms.
- **FE-8 (Low):** `useSearchParams` in `sidebar-recents.tsx:190`, `agent-tree.tsx:54`, `todo-list.tsx:39` relies on an ancestor `<Suspense>` (only `Terminal` is wrapped in `shell.tsx`). Per the project's own gotcha, an unwrapped consumer on a prerendered path breaks the build. **Fix:** confirm each renders under a Suspense boundary; `build:check` would catch a regression.
- **Info — byte-offset parsers:** `usage.ts:105-113`, `calls.ts:119-127`, `otel.ts:140-152`, `events.ts:229-242` are correct for append-only but silently desync if an offset ever advances to a non-newline byte (garbage → caught → dropped → under-reported, no error). Add an assertion/comment that offset must land on `\n`.
- **Info — index-as-key:** `command-palette.tsx:243`, `agent-tree.tsx:188` key by array index — benign here (lists swap wholesale, no per-row state).
- **Info — `readConfig`:** `guardrails.ts:38-50` returns `configured:true` for a present-but-garbage file, suppressing the "set your cap" nudge. Cosmetic.

---

## What's genuinely well-built (verified, no action)

- **No command injection anywhere.** Every subprocess uses `execFile`/`spawn` with array args; `model` (`^[a-z0-9.\-]{1,64}$`), `sha` (`^[0-9a-f]{7,40}$`), and `repo` (`basename`-only) are validated. `lib/shipped.ts` git handling is textbook-hardened.
- **SSE/watcher teardown is clean.** All four stream routes clear every timer and wire `req.signal` `abort`; `lib/watcher.ts` is a single ref-counted recursive `fs.watch` that closes with the last subscriber; `lib/repl.ts`'s reaper is HMR-safe and `.unref()`'d. No leaked stream/watcher/timer found.
- **Crash-safe reads.** Every `JSON.parse(readFileSync(...))` is `try/catch`-wrapped with a sane default — malformed-on-disk never 500s the server.
- **Named-file path guards are sound** (`notes.ts`, `files.ts`, `docs.ts`, `skills.ts`, `audit.ts` modulo SEC-6 width) — `basename`/`resolve`+`startsWith(dir+sep)` correctly reject `../` and absolute escapes.
- **Math is guarded.** Divisions across `usage.ts`/`pricing.ts`/`batch-planner.ts`/`guardrails.ts` guard `> 0`; no NaN/divide-by-zero; the 200k long-context premium is applied per-call and deliberately omitted from aggregate `baseCost`. Cycle handling in `lineage.ts`/`batch-planner.ts` is safe.
- **`calls.ts` already does atomic writes** (temp + `renameSync`) — the exact pattern BUG-1 wants everywhere.

---

## Suggested remediation order (highest leverage first)

1. **SEC-1 + SEC-2** — add `middleware.ts` (Origin/Host check) and `-H 127.0.0.1`. One small change pair closes the entire remote-trigger surface that amplifies SEC-3/4/6/7 and BUG-1's exposure. *Do this first.*
2. **BUG-1** — atomic sidecar writes (port `calls.ts`'s temp+rename) + an in-process per-sidecar mutex. Prevents `todo.json` data loss.
3. **PERF-1** — one shared TTL'd dir-scan cache. Single highest-leverage perf fix; feeds ~6 readers and the always-open SSE backstop.
4. **PERF-3 / PERF-2 / PERF-7** — bound/cache the large-file reads (cap live-scan to a tail; cache the polled tail parses by mtime). Removes the worst event-loop blocks.
5. **SEC-4 + SEC-5** — defense-in-depth so the blast radius is small even if the gate is reached (constrain spawn `cwd`; treat shell metacharacters as `ask`).
6. **BUG-2 + BUG-3** — fix the two wrong *numbers* (Opus-priced sessions; double-counted "$ bled").
7. **FE-1 + FE-2** — abort guard on `loadTurns`; cap/virtualize `items`.
8. The remaining Mediums/Lows as cleanup, plus **DOC-1** (delete the orphan index, correct AGENTS.md).

*End of report — no files were changed.*
