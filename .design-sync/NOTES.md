# design-sync staging notes

Pre-sync audit done 2026-06-22, **before** any real `/design-sync` run (no
project created, nothing uploaded). This file front-loads the scope + setup
decisions so the actual run is fast and deterministic instead of multi-hour
exploration. Everything here is a recommendation — adjust scope before running.

## Repo shape

- **shape: `package`** — hq is a private Next.js *app*, not a packaged library.
  No `dist/`, no Storybook, no `.storybook/`, no `*.stories.*`, no library
  `exports`/`main`/`module`. Deps are only `next`/`react`/`react-dom`.
- The converter's happy path (Storybook screenshots OR a compiled `dist/`) does
  not apply. Drive from source via `componentSrcMap` pointing at individual
  `app/ui/*.tsx` files. No barrel export exists — do not expect one.
- Path alias: `@/` → repo root (tsconfig paths). esbuild must resolve it.

## Styling / tokens (for the conventions header)

- **Tailwind v4, CSS-first.** `app/globals.css` = `@import "tailwindcss";` +
  `@theme inline { --color-*, --font-* }`. There is **no `tailwind.config.*`**.
- Tokens: `--background`/`--foreground` (#09090b / #f4f4f5) on `:root`, mapped
  into `@theme inline` as `--color-background`/`--color-foreground`,
  `--font-sans`/`--font-mono` (Geist). Custom keyframes: `boundary-border-flash`,
  `boundary-chip-flash`, `.boundary-flash` (the rerender-flash motif).
- **Styling idiom = inline Tailwind utility classes** (zinc/blue palette), NOT a
  class-abstraction layer. The shared look constant is `CHIP_CLASS` (in
  `boundary-chip.tsx`) — the chip family's vocabulary. `styles.css` for the sync
  must `@import` globals.css's closure so the @theme tokens reach rendered cards.
- Dark theme by default (zinc-950 bg). The design agent must know components
  expect a dark surface.

## Scope — what to sync (recommended v1)

### Tier 1 — sync-ready core (zero app coupling; the brand-defining primitives)
Pure presentational, props-driven, no router/fs/`@/lib`-data/fetch. Bundle as-is.

- boundary.tsx            (+ boundary-chip.tsx — its dep)
- button-chip-action.tsx
- button-chip-icon.tsx
- copy-code.tsx
- copy-text.tsx
- meta-chip-row.tsx       (+ copy-code dep)
- search-field.tsx
- accordion-item.tsx      ← the real generic primitive (NOT in lib/components.ts!)
- collapsible-boundary.tsx
- tooltip.tsx
- sort-icon.tsx
- md.tsx                  (markdown renderer; emits CopyCode)

### Tier 1b — clean but more app-specific (include only if you want them up)
- sidebar-toggle.tsx (ButtonChipIcon variant), sidebar-column.tsx,
  confirm-dialog.tsx, note-body.tsx, account-chip.tsx, send-box-search.tsx

### Tier 2 — needs a shim (presentational but next/navigation|next/link coupled)
Deferred from v1. To include, stub routing: pass `href`/`onClick` as props and
shim `next/navigation`+`next/link` to plain `<a>`/no-op.
- tab-nav.tsx (navg+link), panel-menu.tsx (navg+link), commit-link.tsx (navg),
  search-trigger.tsx (navg), draggable-card.tsx (link)

### Exclude — not design-system primitives
- Data/runtime-coupled (call live fs readers): token-meter.tsx (getUsage),
  forecast-meter.tsx (getForecast), efficiency.tsx
- Context providers: api-state, command-state, planner-state, sidebar-state,
  text-editor-state
- App containers / feature panels: terminal, shell, app-panel, panel-wrapper,
  sidebar, sidebar-recents, command-palette, api-panel, planner-panel,
  routine-panel, skill-launcher, compose-tray, todo-list, todo-menu,
  components-list, projects-view, project-sessions, projects-item, shipped-feed,
  agent-tree, landing-install, block-menu, text-editor, new-session-item,
  pair-column, search-input, search-scope-filter, search-corpus-rail,
  search-result-card, search-result-group, refresh-on-change, refresh-while,
  flash-on-nav, back-link, accordion-todo-item (app-data wrapper over AccordionItem)

## Registry miscalibration (lib/components.ts) — finish-the-audit fixes
APPROVED ≠ sync-ready. The registry's `status` reflects component quality, but
it's currently wrong on several counts:
- **AccordionItem is unregistered** — the generic primitive is missing while its
  wrapper AccordionTodoItem is APPROVED. Register + approve AccordionItem.
- **Under-rated REVIEW → should be APPROVED** (clean, done primitives):
  CopyText, Tooltip, Markdown (md), CollapsibleBoundary.
- **Keep APPROVED but flag non-sync-ready**: TabNav, PanelMenu, CommitLink
  (routing-coupled → Tier 2 shim, not v1 scope).

## Open items for the real run
1. Create the Claude Design project (needs claude.ai design login; §1 of skill).
2. Confirm Tier 1b inclusion (yes/no per component).
3. Decide Tier 2 shim vs drop.
4. Author `.design-sync/conventions.md` AFTER first build (validate token/class
   names against built artifacts). Draft idiom is captured above.
5. Timing: a first high-fidelity run is multi-hour + token-heavy. Started this
   audit while at ~98% of the 5-hour usage window — run the real sync fresh.
