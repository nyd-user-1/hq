"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the independent Compose panel — the artifact tray you
// gather refs into, then "Send to terminal" drops the assembled prompt into
// Terminal 1's message box. Like the Plugins / Changelog / Skills panels it lives
// in its OWN portal root (#compose-panel-root) driven by this client state —
// orthogonal to the URL-routed @panel — so it can sit open alongside the rest.
// Persisted to localStorage across reloads.
type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const ComposeContext = createContext<Ctx | null>(null);

export function ComposeProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-compose") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-compose", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <ComposeContext.Provider
      value={{
        open,
        setOpen,
        toggle: () => setOpen((v) => !v),
      }}
    >
      {children}
    </ComposeContext.Provider>
  );
}

export function useCompose(): Ctx {
  return (
    useContext(ComposeContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
