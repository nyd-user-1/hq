"use client";

import { createContext, useContext, useState } from "react";

// Shared open/closed state for the left sidebar. The width lives on
// SidebarColumn; the toggle lives in the terminal header (the one element that
// never leaves the page) — this context bridges the two across the server Shell.
const SidebarContext = createContext<{ open: boolean; toggle: () => void }>({
  open: true,
  toggle: () => {},
});

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <SidebarContext.Provider value={{ open, toggle: () => setOpen((v) => !v) }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
