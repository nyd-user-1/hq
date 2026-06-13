"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SEARCH_ITEM } from "@/app/ui/sidebar-nav";
import SidebarRecents from "@/app/ui/sidebar-recents";

// Left rail. Brand → "/" (closes the panel, terminal-only focus). The panel
// groups (Activity/Metrics/Console) moved into the terminal's "panels"
// dropdown, so the sidebar is now just Search + Recent Sessions (Claude-style).
// Client so Search's active state updates without remounting the layout-mounted
// terminal.
export default function Sidebar() {
  const pathname = usePathname() ?? "/";
  const searchActive =
    pathname === SEARCH_ITEM.href ||
    pathname.startsWith(SEARCH_ITEM.href + "/");

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <Link href="/" scroll={false} className="block shrink-0">
        <h1 className="text-base font-semibold tracking-tight">Agentic OS</h1>
      </Link>

      <Link
        href={SEARCH_ITEM.href}
        scroll={false}
        className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
          searchActive
            ? "bg-blue-600 text-white"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        }`}
      >
        {SEARCH_ITEM.title}
      </Link>

      <Suspense fallback={null}>
        <SidebarRecents />
      </Suspense>
    </div>
  );
}
