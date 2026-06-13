// Sidebar nav — plain data, no node:fs (safe to import into the client Sidebar).
// Each item drives the RIGHT app-panel via its URL; the center terminal never
// moves. The brand links to "/" which closes the panel (terminal-only focus).
export type NavItem = { title: string; href: string };
export type NavGroup = { label: string; items: NavItem[] };

export const SIDEBAR_NAV: NavGroup[] = [
  {
    label: "", // unlabeled — Search stands alone at the top
    items: [{ title: "Search", href: "/search" }],
  },
  {
    label: "Activity",
    items: [
      { title: "Calls", href: "/calls" },
      { title: "Sessions", href: "/sessions" },
      { title: "To Do", href: "/todo" },
    ],
  },
  {
    label: "Metrics",
    items: [
      { title: "Usage & Burn", href: "/metrics" },
      { title: "Savings", href: "/savings" },
      { title: "Memory Audit", href: "/audit" },
    ],
  },
  {
    label: "Console",
    items: [
      { title: "Vault Pulse", href: "/pulse" },
      { title: "Skills", href: "/skills" },
      { title: "Routines", href: "/routines" },
    ],
  },
  {
    label: "Work",
    items: [{ title: "Buckets", href: "/buckets" }],
  },
];

// Routes that open the right panel (terminal stays mounted underneath).
export const PANEL_ROUTES = SIDEBAR_NAV.flatMap((g) => g.items.map((i) => i.href));
