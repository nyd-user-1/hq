"use client";

import { usePathname, useRouter } from "next/navigation";
import { withPins } from "@/app/ui/keep-pins";

// Search icon on the terminal boundary, where the "+" used to live: opens the
// Search panel (@panel/search — every session + memory). Toggles, so clicking it
// while open closes the panel. Keeps the terminal pins so it never closes a
// paired terminal.
export default function SearchTrigger() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const active = pathname.startsWith("/search");
  return (
    <button
      onClick={() =>
        router.push(withPins(active ? "/" : "/search", window.location.search), {
          scroll: false,
        })
      }
      aria-label="Search every session and memory"
      className={`boundary-flash-chip flex cursor-pointer items-center px-1.5 py-0.5 transition-colors ${
        active
          ? "bg-zinc-700 text-zinc-200"
          : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
      }`}
    >
      {/* lucide Search */}
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
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  );
}
