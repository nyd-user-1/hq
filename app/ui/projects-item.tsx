"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// Projects nav item — sits directly under "New Session" in the sidebar. Opens the
// full-width Projects browser (project-overlay.tsx) over the center column via
// ?center=project, mirroring FilesItem: a query toggle (not a route) so it keeps
// the current panel + the terminal pins; clicking again (or any session) drops it.
export default function ProjectsItem() {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const active = params.get("center") === "project";
  const sp = new URLSearchParams(params.toString());
  if (active) sp.delete("center");
  else sp.set("center", "project");
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
      {/* lucide Folder */}
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
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      </svg>
      Projects
    </Link>
  );
}
