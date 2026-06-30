"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the independent Calls panel — the dollar-priced ledger of
// every API round-trip across all transcripts (rows: time · project · model · out
// · raw · cost; a row opens its full token/$ breakdown). Like the Changelog /
// Skills / Plugins panels it lives in its OWN portal root (#calls-panel-root)
// driven by this client state — orthogonal to the URL-routed @panel — so it can
// sit open alongside Activity/Search/etc. Persisted to localStorage across reloads.
type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const CallsContext = createContext<Ctx | null>(null);

export function CallsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-calls") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-calls", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <CallsContext.Provider
      value={{
        open,
        setOpen,
        toggle: () => setOpen((v) => !v),
      }}
    >
      {children}
    </CallsContext.Provider>
  );
}

export function useCalls(): Ctx {
  return (
    useContext(CallsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
