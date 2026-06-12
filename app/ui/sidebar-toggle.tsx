"use client";

import { useSidebar } from "@/app/ui/sidebar-state";

// The sidebar toggle as its OWN chip, sitting on the terminal boundary just
// before the terminal.tsx path chip — the terminal never leaves the page, so
// the toggle is always reachable even with the sidebar fully off-screen.
export default function SidebarToggle() {
  const { open, toggle } = useSidebar();
  return (
    <button
      onClick={toggle}
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      className="flex shrink-0 items-center bg-zinc-800 px-1.5 py-0.5 text-zinc-400 transition-colors hover:text-zinc-100"
    >
      {/* lucide PanelLeftClose / PanelLeftOpen */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M9 3v18" />
        {open ? <path d="m16 15-3-3 3-3" /> : <path d="m14 9 3 3-3 3" />}
      </svg>
    </button>
  );
}
