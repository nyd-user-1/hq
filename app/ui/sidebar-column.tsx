"use client";

import { useState } from "react";

// Collapsible left rail (the sports/44b pattern): sidebarOpen state + a width
// transition w-[210px] ↔ w-0. The PanelLeft toggle floats at the top-right of
// the open sidebar and stays behind as a slim top-left rail when collapsed.
// The sidebar content (Boundary + Sidebar) comes in as children from the
// server Shell so this stays pure mechanics.
export default function SidebarColumn({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="relative flex shrink-0">
      <div
        className={`flex min-h-0 overflow-hidden transition-all duration-300 ease-in-out ${
          open ? "w-[210px]" : "w-0"
        }`}
      >
        {children}
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        className={`z-10 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 ${
          open ? "absolute right-2 top-2" : "mt-1 self-start"
        }`}
      >
        {/* lucide PanelLeftClose / PanelLeftOpen */}
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M9 3v18" />
          {open ? <path d="m16 15-3-3 3-3" /> : <path d="m14 9 3 3-3 3" />}
        </svg>
      </button>
    </div>
  );
}
