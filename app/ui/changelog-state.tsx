"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the independent Changelog panel — the cross-project commit
// timeline (cards: title · files · summary · diff). Like the Plugins / API /
// Planner panels it lives in its OWN portal root (#changelog-panel-root) driven by
// this client state — orthogonal to the URL-routed @panel — so it can sit open
// alongside Activity/Search/etc. Persisted to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const ChangelogContext = createContext<Ctx | null>(null);

export function ChangelogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-changelog") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-changelog", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <ChangelogContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </ChangelogContext.Provider>
  );
}

export function useChangelog(): Ctx {
  return (
    useContext(ChangelogContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
