"use client";

import ButtonChipIcon from "@/app/ui/button-chip-icon";
import { useSidebar } from "@/app/ui/sidebar-state";

// The sidebar toggle as its OWN chip, sitting on the terminal boundary just
// before the terminal.tsx path chip — the terminal never leaves the page, so
// the toggle is always reachable even with the sidebar fully off-screen. A
// variant of ButtonChipIcon (icon + handler).
export default function SidebarToggle() {
  const { open, toggle } = useSidebar();
  return (
    <ButtonChipIcon
      onClick={toggle}
      label={open ? "Collapse sidebar" : "Expand sidebar"}
      // join the rerender flash on reload like the other boundary chips; self-stretch
      // matches the icon chip's height to the taller text label beside it.
      className="boundary-flash-chip shrink-0 self-stretch"
      icon={
        // A bare chevron matching the wall pane's "▾" menu chip: pointing LEFT when
        // open (click closes it leftward), RIGHT when closed (click opens it right).
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {open ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
        </svg>
      }
    />
  );
}
