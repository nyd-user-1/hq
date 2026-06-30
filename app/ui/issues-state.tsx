"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Issues panel — the hq repo's GitHub Issues
// list + composer, read via `gh`. Like the Changelog / Teams panels it lives in its
// OWN portal root (#issues-panel-root) driven by this client state — orthogonal to
// the URL-routed @panel — so it can sit open alongside Activity/Search/etc.
// Persisted to localStorage across reloads.
type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const IssuesContext = createContext<Ctx | null>(null);

export function IssuesProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-issues") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-issues", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <IssuesContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </IssuesContext.Provider>
  );
}

export function useIssues(): Ctx {
  return (
    useContext(IssuesContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
