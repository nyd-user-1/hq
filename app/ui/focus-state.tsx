"use client";

import { createContext, useContext, useMemo, useState } from "react";

// Focus = the active terminal (Chrome's "active window"). Exactly one terminal is
// active at a time; it wears a blue resting boundary and is the target the
// sidebar/panels drive (the latter lands with the per-terminal content schema).
// Ephemeral interaction state — NOT the URL (terminal-1 IS the URL; the active
// MARKER is just "which pane has my attention right now"), so it lives in client
// state, defaulting to terminal-1. Keys: "t1" for Terminal 1, "t2".."t4" for the
// wall panes (slot-based, stable across the session a pane shows).
type FocusCtx = { activeKey: string; setActive: (key: string) => void };

// A non-undefined default so useFocus() never throws if a Terminal renders outside
// the provider (e.g. an isolated test) — it just no-ops, treating t1 as active.
const Ctx = createContext<FocusCtx>({ activeKey: "t1", setActive: () => {} });

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const [activeKey, setActive] = useState("t1");
  const value = useMemo(() => ({ activeKey, setActive }), [activeKey]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFocus = () => useContext(Ctx);
