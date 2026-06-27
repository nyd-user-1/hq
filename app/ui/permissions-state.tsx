"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the Permissions panel — first tab of the new Config group,
// its own #permissions-panel-root portal. Persisted to localStorage.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const PermissionsContext = createContext<Ctx | null>(null);

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-permissions") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-permissions", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <PermissionsContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): Ctx {
  return (
    useContext(PermissionsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
