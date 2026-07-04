"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/active state for the Teams container (teams-group-panel.tsx) — ONE push-in
// panel hosting Teams (roster) · Mailbox, swapping between them in place. Mirrors
// console-state.tsx. Named "teams-group" so it doesn't collide with the teams-panel
// member's own useTeams state.
export type TeamsGroupKey = "teams" | "mailbox";

export const TEAMS_GROUP_PANELS: { key: TeamsGroupKey; title: string; file: string }[] = [
  { key: "teams", title: "Teams", file: "teams-panel.tsx" },
  { key: "mailbox", title: "Mailbox", file: "mailbox-panel.tsx" },
];

const KEYS = TEAMS_GROUP_PANELS.map((p) => p.key) as string[];
function isKey(v: string | null): v is TeamsGroupKey {
  return !!v && KEYS.includes(v);
}

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  active: TeamsGroupKey;
  setActive: (k: TeamsGroupKey) => void;
  openAt: (k: TeamsGroupKey) => void;
};

const TeamsGroupContext = createContext<Ctx | null>(null);

export function TeamsGroupProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<TeamsGroupKey>("teams");

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-teams-group") === "1");
      const a = localStorage.getItem("hq-teams-group-active");
      if (isKey(a)) setActive(a);
    } catch {
      /* no storage — defaults stand */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-teams-group", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  useEffect(() => {
    try {
      localStorage.setItem("hq-teams-group-active", active);
    } catch {
      /* ignore */
    }
  }, [active]);

  return (
    <TeamsGroupContext.Provider
      value={{
        open,
        setOpen,
        toggle: () => setOpen((v) => !v),
        active,
        setActive,
        openAt: (k) => {
          setActive(k);
          setOpen(true);
        },
      }}
    >
      {children}
    </TeamsGroupContext.Provider>
  );
}

export function useTeamsGroup(): Ctx {
  return (
    useContext(TeamsGroupContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
      active: "teams",
      setActive: () => {},
      openAt: () => {},
    }
  );
}
