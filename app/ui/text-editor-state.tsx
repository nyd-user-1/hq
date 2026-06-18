"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// Open/close + draft state for the full-screen Text capture editor — a scratch
// surface you paste a big body of text into, then save as a searchable HQ note
// (same store as the "save as a note" button → shows up in Search's Notes
// scope). Lives in its OWN client state (like the Batch Planner) so it floats
// over the whole shell, orthogonal to the URL-routed @panel.
//
// The DRAFT persists to localStorage (don't lose a big paste to an accidental
// refresh); whether it's OPEN does NOT (a refresh shouldn't re-pop the modal).
// A "#text" hash opens it on load, so a /text skill can deep-link from the CLI
// (open http://localhost:3002/#text).
const DRAFT_KEY = "hq-text-draft";

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  text: string;
  setText: (v: string) => void;
  clear: () => void;
};

const TextEditorContext = createContext<Ctx | null>(null);

export function TextEditorProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  // Restore a persisted draft + honor a "#text" deep-link on first paint.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setText(saved);
    } catch {
      /* no storage — start blank */
    }
    const openFromHash = () => {
      if (window.location.hash !== "#text") return;
      setOpen(true);
      // Strip the hash so a later refresh doesn't silently re-open the modal.
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  // Persist the draft as it changes (cleared on a successful save).
  useEffect(() => {
    try {
      if (text) localStorage.setItem(DRAFT_KEY, text);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }, [text]);

  const clear = useCallback(() => setText(""), []);

  return (
    <TextEditorContext.Provider
      value={{
        open,
        setOpen,
        toggle: () => setOpen((v) => !v),
        text,
        setText,
        clear,
      }}
    >
      {children}
    </TextEditorContext.Provider>
  );
}

export function useTextEditor(): Ctx {
  return (
    useContext(TextEditorContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
      text: "",
      setText: () => {},
      clear: () => {},
    }
  );
}
