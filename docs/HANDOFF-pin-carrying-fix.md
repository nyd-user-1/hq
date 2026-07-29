# Kill the pin-carrying rule — make the invariant unrepresentable

**Written:** 2026-07-29 by the 44B lead, at Brendan's direction. **Status: SPEC, buildable
as one HQ session.** Supersedes the deferred To Do `t_c6cae04f76` (options A + B — this is
both, plus enforcement). Read first: `AGENTS.md` §Architecture (the pin-carrying
paragraph and its Gotchas twin — the text this spec exists to delete).

## 1. The defect, precisely

The terminal must stay pinned to `?session`/`?pair`. Today that invariant is enforced **at
every call site**: any in-panel `<Link>` or router call that drops the params unpins the
terminal, which then *self-re-pins to the newest session* via `router.replace` — switching
the session under the user AND wiping the panel's own params (the "card opens then snaps
back" bug). The rule "every new in-panel link MUST carry the pins" is self-described
whack-a-mole: it has already been fixed one-off across shipped/audit/sessions/sdk/savings/
`CommitLink`, and every future link is a fresh chance to regress. Rules that must be
repeated in docs are architecture debt — the fix belongs in code.

Two moves, in this order: **remove the hair trigger** (so a dropped pin costs nothing),
then **centralize the carrying** (so pins can't be dropped anyway), then **enforce** (so
the old pattern can't return silently).

## 2. Phase A — restore, don't jump (the deeper fix)

Change the terminal's unpinned behavior from "jump to newest" to "restore last pin."

- **State:** on every successful pin, write `{session, pair}` to `sessionStorage`
  (`hq-last-pin`). Per-tab on purpose — two tabs pinned to different sessions must not
  fight, which rules out a cookie/sidecar as the *primary* store. Additionally mirror to
  the existing cookie pattern (`hq-sidebar` precedent) as a *cold-start default only*.
- **Behavior:** when the URL lacks `?session`:
  1. `sessionStorage` pin exists → `router.replace` back to **that** session — and build
     the query by **merging into the current searchParams**, never from scratch (the
     params-wipe half of the bug is the rebuild-from-nothing).
  2. No stored pin (true cold open) → today's behavior, newest session. Unchanged.
- **Result:** a pin-dropping link now costs one silent replace back to the same session —
  the failure mode ceases to exist. This phase alone ends the user-visible bug even if a
  bad link ships.

## 3. Phase B — the chokepoint: `<PanelLink>`

`app/ui/panel-link.tsx` (kebab-case file, PascalCase component, per house taxonomy):
wraps `next/link`, reads current `useSearchParams`, merges the href's own params with the
pins via the existing `withPins` (`app/ui/keep-pins.ts`) — promoting it from a
utility-you-must-remember to a component-you-can't-avoid. Props pass through; `href` may
be string or object. Then migrate every in-panel link to it — including the ones already
hand-fixed (shipped, audit, sessions, sdk, savings, `CommitLink`, `back-link.tsx`) so the
hand-threading disappears rather than lingering as a second idiom. `BackLink` keeps its
push+`router.refresh()` behavior (the parallel-route cache gotcha is separate and stays).

## 4. Phase C — enforcement

ESLint (flat config, `eslint.config.mjs`): a `files: ["app/**/@panel/**", "app/ui/*-panel*.tsx"]`
override with `no-restricted-imports` banning `next/link` (message: "use PanelLink — it
carries the terminal pins"), excepting `panel-link.tsx` itself. The pre-push hook already
runs eslint, so the ban is enforced at push time with zero new machinery. If a legitimate
pinless link ever exists inside a panel, it opts out with a one-line disable comment that
names its reason — visible in review, not silent.

## 5. The doc deletion is part of the definition of done

- `AGENTS.md`: rewrite the pin-carrying Architecture bullet and its Gotchas twin from
  "every link MUST carry the pins (whack-a-mole)" to two sentences: pins restore
  themselves (Phase A); in-panel links use `<PanelLink>` (Phases B/C). Delete the
  deferred-fix caveat.
- To Do `t_c6cae04f76`: mark done (`~/.claude/hq/todo.json`) with a pointer to the commit.

## 6. Acceptance

1. Reproduce "card opens then snaps back" on a deliberately pinless in-panel link
   **before** the change; after Phase A it restores the same session with panel params
   intact; after Phase B the link carries pins anyway.
2. Cold open in a fresh tab still lands on the newest session (unchanged).
3. Two tabs pinned to different sessions navigate independently (sessionStorage).
4. `npm run build:check` + eslint green; the lint ban demonstrably fires on a raw
   `next/link` added to a panel file (prove it in the report, then remove the probe).
5. `AGENTS.md` no longer contains the word "whack-a-mole."
