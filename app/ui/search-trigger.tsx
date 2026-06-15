"use client";

import { usePathname, useRouter } from "next/navigation";
import { CHIP_CLASS } from "@/app/ui/boundary-chip";
import { withPins } from "@/app/ui/keep-pins";

// Search as a BoundaryChip VARIANT: the shared chip shell + a 🔍 glyph marking
// enhanced functionality (opens @panel/search — every session + memory). Sibling
// of PanelMenu (the ▾ variant). Toggles: clicking while open closes the panel.
// Keeps the terminal pins so it never closes a paired terminal.
export default function SearchTrigger() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const active = pathname.startsWith("/search");
  return (
    <button
      title="Search every session and memory"
      onClick={() =>
        router.push(withPins(active ? "/" : "/search", window.location.search), {
          scroll: false,
        })
      }
      className={`${CHIP_CLASS} flex shrink-0 items-center gap-1 ${
        active ? "text-zinc-100" : ""
      }`}
    >
      Search
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  );
}
