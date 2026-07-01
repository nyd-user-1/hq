"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Mailbox panel — a sibling of the Tasks
// panel (its own #mailbox-panel-root portal). Drills into a team's inter-agent
// message traffic (the active team id is stashed in localStorage "hq-mailbox-team"
// by the Teams panel). Persisted to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const MailboxContext = createContext<Ctx | null>(null);

export function MailboxProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-mailbox") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-mailbox", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <MailboxContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </MailboxContext.Provider>
  );
}

export function useMailbox(): Ctx {
  return (
    useContext(MailboxContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
