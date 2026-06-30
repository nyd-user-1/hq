"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Guardrails panel — the cost-guardrails
// snapshot (weekly cap · burn rate · 2× cliff bleed · top sessions · OTel
// overlay). Like the Changelog / Plugins / Skills panels it lives in its OWN
// portal root (#guardrails-panel-root) driven by this client state — orthogonal
// to the URL-routed @panel — so it can sit open alongside Activity/Search/etc.
// Persisted to localStorage across reloads.
type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const GuardrailsContext = createContext<Ctx | null>(null);

export function GuardrailsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-guardrails") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-guardrails", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <GuardrailsContext.Provider
      value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}
    >
      {children}
    </GuardrailsContext.Provider>
  );
}

export function useGuardrails(): Ctx {
  return (
    useContext(GuardrailsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}
