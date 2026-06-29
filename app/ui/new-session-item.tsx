"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSidebar } from "@/app/ui/sidebar-state";

// The sidebar's primary action: stage a fresh session (?session=new) — where you
// pick a project and HQ drives a new session right there. Also collapses the
// sidebar so the staging view gets the full width (you're done with the rail).
export default function NewSessionItem() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  // Exclusive-blue: New Session lights only when it's the surface actually showing.
  // A center overlay (Projects/Files/Fleet via ?center) sits ON TOP of the staging
  // terminal, so it owns the highlight — don't also light New Session, or two items
  // read "open" at once (the bug). center overlays are single-valued, so at most one
  // sidebar item is ever blue.
  const staged = params.get("session") === "new" && !params.get("center");
  const { open, toggle } = useSidebar();
  return (
    <button
      onClick={() => {
        router.push(`${pathname}?session=new`, { scroll: false });
        if (open) toggle(); // collapse the rail; the staging view takes over
      }}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
        staged
          ? "bg-blue-600 text-white"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      }`}
    >
      {/* lucide Plus */}
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
        <path d="M12 5v14M5 12h14" />
      </svg>
      New Session
    </button>
  );
}
