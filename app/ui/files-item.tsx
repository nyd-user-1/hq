"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Files nav item — sits under "Projects" in the sidebar. Shows the Files browser
// IN Terminal 1 (the tab model: ?session=@files → Terminal1Slot → PaneView), not a
// center overlay. A query toggle so it preserves the current panel + the wall;
// clicking it again drops back to home.
export default function FilesItem() {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const active = params.get("session") === "@files";
  const sp = new URLSearchParams(params.toString());
  sp.delete("center"); // legacy overlay param — retired
  sp.delete("lead"); // a view isn't a team lead
  if (active) sp.delete("session"); // toggle off → home
  else sp.set("session", "@files"); // Files fills Terminal 1
  const href = `${pathname}${sp.toString() ? `?${sp}` : ""}`;
  return (
    <Link
      href={href}
      scroll={false}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      }`}
    >
      {/* lucide Files */}
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
        <path d="M20 7h-3a2 2 0 0 1-2-2V2" />
        <path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z" />
        <path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8" />
      </svg>
      Files
    </Link>
  );
}
