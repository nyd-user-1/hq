"use client";

import { createContext, useContext, useState } from "react";

// Shared open/closed state for the left sidebar. The width lives on
// SidebarColumn; the toggle lives in the terminal header (the one element that
// never leaves the page) — this context bridges the two across the server Shell.
// The open/closed choice persists in an `hq-sidebar` cookie, which the server
// Shell reads to seed `initialOpen` — so a refresh keeps the last state with no
// flash.
const SidebarContext = createContext<{ open: boolean; toggle: () => void }>({
  open: true,
  toggle: () => {},
});

export function SidebarProvider({
  initialOpen = true,
  children,
}: {
  initialOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      document.cookie = `hq-sidebar=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  return (
    <SidebarContext.Provider value={{ open, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
