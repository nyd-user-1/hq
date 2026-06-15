"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { withPins } from "@/app/ui/keep-pins";

// Projects nav item — sits directly under "New Session" in the sidebar. Opens the
// Projects panel (/projects) while keeping the terminal pins (?session/?pair).
// Lives here (not the panels dropdown) so Projects reads as a top-level
// destination, claude.ai-style.
export default function ProjectsItem() {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const active =
    pathname === "/projects" || pathname.startsWith("/projects/");
  // Toggle: open the panel if closed, close it (→ "/") if already open.
  const href = active
    ? withPins("/", params.toString())
    : withPins("/projects", params.toString());
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
