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
  { title: "Activity", href: "/todo", routes: ["/todo", "/sessions", "/sdk"] },
  { title: "Metrics", href: "/metrics", routes: ["/metrics", "/calls", "/savings", "/audit"] },
  { title: "Console", href: "/shipped", routes: ["/shipped", "/skills", "/cmd", "/routines", "/firehose"] },
  { title: "Compose", href: "/compose", routes: ["/compose"] },
];

// Routes that open the right panel (terminal stays mounted underneath).
export const PANEL_ROUTES = [
  SEARCH_ITEM.href,
  ...PANELS.flatMap((p) => p.routes),
];
