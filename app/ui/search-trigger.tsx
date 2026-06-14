"use client";

import { usePathname, useRouter } from "next/navigation";
import ButtonChipIcon from "@/app/ui/button-chip-icon";
import { withPins } from "@/app/ui/keep-pins";

// Search icon on the terminal boundary, where the "+" used to live: opens the
// Search panel (@panel/search — every session + memory). Toggles, so clicking it
// while open closes the panel. Keeps the terminal pins so it never closes a
// paired terminal. A variant of ButtonChipIcon — the `active` (panel-open) one.
export default function SearchTrigger() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const active = pathname.startsWith("/search");
  return (
    <ButtonChipIcon
      active={active}
      className="boundary-flash-chip"
      label="Search every session and memory"
      onClick={() =>
        router.push(withPins(active ? "/" : "/search", window.location.search), {
          scroll: false,
        })
      }
      icon={
        // lucide Search
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
      }
    />
  );
}
