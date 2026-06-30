"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the independent Firehose panel — the everything-view of a
// session's transcript (raw fields, nothing computed; live-tailed). Like the
// Changelog / Skills panels it lives in its OWN portal root (#firehose-panel-root)
// driven by this client state — orthogonal to the URL-routed @panel — so it can
// sit open alongside Activity/Search/etc. Persisted to localStorage across reloads.
type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const FirehoseContext = createContext<Ctx | null>(null);

export function FirehoseProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-firehose") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-firehose", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <FirehoseContext.Provider
      value={{
        open,
        setOpen,
        toggle: () => setOpen((v) => !v),
      }}
    >
      {children}
    </FirehoseContext.Provider>
  );
}

export function useFirehose(): Ctx {
  return (
    useContext(FirehoseContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
