// Nav data — plain, no node:fs (safe in the client Sidebar / Terminal). Search
// lives in the sidebar; the panel groups moved into the terminal's "panels"
// dropdown, each opening a tabbed panel at its first tab (the panel's own tabs
// handle sub-navigation, so no sidebar sub-items).
export type NavItem = { title: string; href: string };

// Search is now the all-time, full-text surface (transcripts + memory): the
// Archive merged into it (lib/archive.ts powers the transcript half).
export const SEARCH_ITEM: NavItem = { title: "Search", href: "/search" };

// The "panels" dropdown. `href` = the first tab (where the panel opens);
// `routes` = every tab under it, for active-state + the open-panel test.
export const PANELS: { title: string; href: string; routes: string[] }[] = [
  { title: "Activity", href: "/projects", routes: ["/projects", "/todo", "/components", "/shipped"] },
  { title: "Metrics", href: "/metrics", routes: ["/metrics", "/calls", "/guardrails", "/savings", "/audit"] },
  { title: "Console", href: "/tree", routes: ["/tree", "/skills", "/cmd", "/routines", "/firehose"] },
  { title: "Compose", href: "/compose", routes: ["/compose"] },
];

// Routes that open the right panel (terminal stays mounted underneath).
// "/projects" is now the Activity panel's first tab (see PANELS above), so it
// comes in via the flatMap; the sidebar's Projects item still links to it.
export const PANEL_ROUTES = [
  SEARCH_ITEM.href,
  ...PANELS.flatMap((p) => p.routes),
];

// Flat list of every navigable destination, for the ⌘K command palette (and any
// future "jump to" surface). `group` is the panel-menu group it lives under (the
// right-aligned tag in the palette); `keywords` are extra search aliases so e.g.
// "tokens" finds Usage, "diff" finds Shipped. One source of truth — the group
// layouts still own their own TabNav titles, this mirrors them for search.
export type NavTarget = { title: string; href: string; group: string; keywords?: string };

export const NAV_TARGETS: NavTarget[] = [
  // Activity
  { title: "Projects", href: "/projects", group: "Activity", keywords: "repos repositories code" },
  { title: "To Do", href: "/todo", group: "Activity", keywords: "tasks todos queue" },
  { title: "Components", href: "/components", group: "Activity", keywords: "design system library ui registry" },
  { title: "Shipped", href: "/shipped", group: "Activity", keywords: "commits git diff feed changelog" },
  // Metrics
  { title: "Usage", href: "/metrics", group: "Metrics", keywords: "tokens usage burn meter context cost rate limit" },
  { title: "Calls", href: "/calls", group: "Metrics", keywords: "ledger dollars cost spend api" },
  { title: "Guardrails", href: "/guardrails", group: "Metrics", keywords: "cost cap budget burn rate limit spend alarm projection otel" },
  { title: "Savings", href: "/savings", group: "Metrics", keywords: "efficiency saved" },
  { title: "Memory Audit", href: "/audit", group: "Metrics", keywords: "memory notes audit" },
  // Console
  { title: "Tree", href: "/tree", group: "Console", keywords: "agents subagents hierarchy background dispatched jobs teams sidechain explore" },
  { title: "Skills", href: "/skills", group: "Console", keywords: "skills launcher commands" },
  { title: "CMD", href: "/cmd", group: "Console", keywords: "slash commands cli reference" },
  { title: "Routines", href: "/routines", group: "Console", keywords: "cron scheduled jobs" },
  { title: "Firehose", href: "/firehose", group: "Console", keywords: "stream events live feed" },
  // Standalone panels. (Search isn't here — the palette's own input IS the
  // global search now; the magnifier chip still opens the full /search page.)
  { title: "Compose", href: "/compose", group: "", keywords: "tray assemble send refs" },
];

// ── The header nav bar (panel-nav-bar.tsx) ─────────────────────────────────
// The horizontal nav: THREE dropdown headers (Activity · Console · Metrics),
// styled like the send-box model selector. Every destination is a leaf —
// EITHER a route (href → a pin-carrying Link) OR a client-state toggle (one of
// the independent panels: api/planner/text/plugins, which open alongside a route
// panel). API + Plugins used to be standalone headers; they're folded in as
// toggle leaves now (API under Metrics, Plugins under Console). `cols` lays a
// crowded dropdown out in a grid (Console 2×3, Metrics 2×4). Source of truth for
// STRUCTURE + ORDER; routing/open-tests still run off PANEL_ROUTES + the
// client-state contexts.
export type ToggleKey = "api" | "planner" | "text" | "plugins";
export type NavLeaf =
  | { title: string; href: string }
  | { title: string; toggle: ToggleKey };
export type NavHeader = { title: string; items: NavLeaf[]; cols?: number };

export const NAV_HEADERS: NavHeader[] = [
  {
    title: "Activity",
    items: [
      { title: "Projects", href: "/projects" },
      { title: "To Do", href: "/todo" },
      { title: "Components", href: "/components" },
      { title: "Shipped", href: "/shipped" },
      { title: "Compose", href: "/compose" },
    ],
  },
  {
    title: "Console",
    cols: 2, // 6 items → 2×3
    items: [
      { title: "Text", toggle: "text" },
      { title: "Tree", href: "/tree" },
      { title: "Skills", href: "/skills" },
      { title: "CMD", href: "/cmd" },
      { title: "Routines", href: "/routines" },
      { title: "Plugins", toggle: "plugins" },
    ],
  },
  {
    title: "Metrics",
    cols: 2, // 8 items → 2×4
    items: [
      { title: "Usage", href: "/metrics" },
      { title: "Calls", href: "/calls" },
      { title: "Guardrails", href: "/guardrails" },
      { title: "Savings", href: "/savings" },
      { title: "Memory Audit", href: "/audit" },
      { title: "Planner", toggle: "planner" },
      { title: "API", toggle: "api" },
      { title: "Firehose", href: "/firehose" },
    ],
  },
];
