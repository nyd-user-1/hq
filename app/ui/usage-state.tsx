"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Usage panel — HQ's read of the live
// rate-limit / token meters + burn forecast (the old @panel/(metrics)/metrics
// landing tab). Like the Skills / Changelog panels it lives in its OWN portal
// root (#usage-panel-root) driven by this client state — orthogonal to the
// URL-routed @panel — so it can sit open alongside Activity/Search/etc.
// Persisted to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const UsageContext = createContext<Ctx | null>(null);

export function UsageProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-usage") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-usage", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <UsageContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </UsageContext.Provider>
  );
}

export function useUsage(): Ctx {
  return (
    useContext(UsageContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
