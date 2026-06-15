"use client";

import { useSidebar } from "@/app/ui/sidebar-state";

// Collapsible left rail (the sports/44b pattern): width transition w-[…] ↔ w-0,
// fully off-screen when closed so the terminal reclaims the space. Narrower
// (180px) on smaller viewports so it doesn't crowd the terminal; 240px at xl+.
// The toggle is in the terminal header; state comes from SidebarProvider.
export default function SidebarColumn({
  children,
}: {
  children: React.ReactNode;
}) {
  const { open } = useSidebar();

  return (
    <div
      className={`flex min-h-0 shrink-0 transition-all duration-300 ease-in-out [clip-path:inset(-12px_0px_0px_0px)] ${
        open ? "mr-4 w-[180px] xl:w-[240px]" : "w-0"
      }`}
    >
      {children}
    </div>
  );
}
