"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the independent Trusted Folders panel — the list of
// project directories Claude Code knows about (from ~/.claude.json), each marked
// trusted or not. Like the Changelog / Permissions panels it lives in its OWN
// portal root (#trusted-folders-panel-root) driven by this client state —
// orthogonal to the URL-routed @panel — so it can sit open alongside the others.
// Persisted to localStorage (key "hq-trusted-folders") across reloads.
type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const TrustedFoldersContext = createContext<Ctx | null>(null);

export function TrustedFoldersProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-trusted-folders") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-trusted-folders", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <TrustedFoldersContext.Provider
      value={{
        open,
        setOpen,
        toggle: () => setOpen((v) => !v),
      }}
    >
      {children}
    </TrustedFoldersContext.Provider>
  );
}

export function useTrustedFolders(): Ctx {
  return (
    useContext(TrustedFoldersContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
