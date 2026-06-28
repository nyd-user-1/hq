"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the independent Changelog panel — the cross-project commit
// timeline (cards: title · files · summary · diff). Like the Plugins / API /
// Planner panels it lives in its OWN portal root (#changelog-panel-root) driven by
// this client state — orthogonal to the URL-routed @panel — so it can sit open
// alongside Activity/Search/etc. Persisted to localStorage across reloads.
//
// `target` + `openAt` are the deep-link primitive that replaced the old Shipped
// route: a chat-reply sha (CommitLink) calls openAt(sha) to open the panel AND
// drill straight to that commit's diff — no URL nav, so no pin-carrying to get
// wrong. The panel consumes the target then clears it.
type CommitTarget = { sha: string; repo?: string };
type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  target: CommitTarget | null;
  openAt: (sha: string, repo?: string) => void;
  clearTarget: () => void;
};

const ChangelogContext = createContext<Ctx | null>(null);

export function ChangelogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<CommitTarget | null>(null);
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
    <ChangelogContext.Provider
      value={{
        open,
        setOpen,
        toggle: () => setOpen((v) => !v),
        target,
        openAt: (sha, repo) => {
          setTarget({ sha, repo });
          setOpen(true);
        },
        clearTarget: () => setTarget(null),
      }}
    >
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
      target: null,
      openAt: () => {},
      clearTarget: () => {},
    }
  );
}
