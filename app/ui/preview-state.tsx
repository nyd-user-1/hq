"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the independent Preview panel — an in-app live view of a
// project's local dev server (iframe + reconnect lifecycle), so a dev-server
// restart never bounces you to Safari's dead page. Like the Plugins/API/Planner
// panels it lives in its OWN portal root (#preview-panel-root) driven by this
// client state, so it can sit open alongside Activity/Search/etc. Persisted.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const PreviewContext = createContext<Ctx | null>(null);

export function PreviewProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-preview") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-preview", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <PreviewContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </PreviewContext.Provider>
  );
}

export function usePreview(): Ctx {
  return (
    useContext(PreviewContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
