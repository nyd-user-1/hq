"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Memory Audit panel — the standing context
// tax made visible (every-session instruction files + the memory store, heaviest
// first, with stale flags). Like the Skills / Changelog panels it lives in its
// OWN portal root (#audit-panel-root) driven by this client state — orthogonal to
// the URL-routed @panel — so it can sit open alongside Activity/Search/etc.
// Persisted to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const AuditContext = createContext<Ctx | null>(null);

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-audit") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-audit", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <AuditContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </AuditContext.Provider>
  );
}

export function useAudit(): Ctx {
  return (
    useContext(AuditContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
