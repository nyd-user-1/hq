"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Fleet nav item — sits under "Files" in the sidebar. Shows the mission-control
// roster IN Terminal 1 (the tab model: ?session=@fleet → Terminal1Slot → PaneView),
// not a center overlay. A query toggle so it preserves the open panel + the wall;
// clicking it again drops back to home.
export default function FleetItem() {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const active = params.get("session") === "@fleet";
  const sp = new URLSearchParams(params.toString());
  sp.delete("center"); // legacy overlay param — retired
  sp.delete("lead"); // a view isn't a team lead
  if (active) sp.delete("session"); // toggle off → home
  else sp.set("session", "@fleet"); // Fleet fills Terminal 1
  const href = `${pathname}${sp.toString() ? `?${sp}` : ""}`;
  return (
    <Link
      href={href}
      scroll={false}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      }`}
    >
      {/* lucide layout-grid — the mission-control roster */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <rect width="7" height="7" x="3" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="14" rx="1" />
        <rect width="7" height="7" x="3" y="14" rx="1" />
      </svg>
      Fleet
    </Link>
  );
}
