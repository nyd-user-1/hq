// Nav data — plain, no node:fs (safe in the client Sidebar / Terminal). Search
// lives in the sidebar; the panel groups moved into the terminal's "panels"
// dropdown, each opening a tabbed panel at its first tab (the panel's own tabs
// handle sub-navigation, so no sidebar sub-items).
export type NavItem = { title: string; href: string };

export const SEARCH_ITEM: NavItem = { title: "Search", href: "/search" };
export const ARCHIVE_ITEM: NavItem = { title: "Archive", href: "/archive" };

// The "panels" dropdown. `href` = the first tab (where the panel opens);
// `routes` = every tab under it, for active-state + the open-panel test.
export const PANELS: { title: string; href: string; routes: string[] }[] = [
  { title: "Activity", href: "/calls", routes: ["/calls", "/sessions", "/todo"] },
  { title: "Metrics", href: "/metrics", routes: ["/metrics", "/savings", "/audit"] },
  { title: "Console", href: "/pulse", routes: ["/pulse", "/skills", "/routines"] },
];

// Routes that open the right panel (terminal stays mounted underneath).
export const PANEL_ROUTES = [
  SEARCH_ITEM.href,
  ARCHIVE_ITEM.href,
  ...PANELS.flatMap((p) => p.routes),
];
