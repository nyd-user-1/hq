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

// When set, the editor is in "edit an existing file" mode (the ⌘K reader's pencil)
// rather than "new note" mode: save writes back to this file via /api/file-edit.
export type EditTarget = { kind: string; ref: string; title: string } | null;

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  text: string;
  setText: (v: string) => void;
  clear: () => void;
  editTarget: EditTarget;
  openEdit: (t: { kind: string; ref: string; title: string; content: string }) => void;
  closeEdit: () => void;
};

const TextEditorContext = createContext<Ctx | null>(null);

export function TextEditorProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [editTarget, setEditTarget] = useState<EditTarget>(null);

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

  // Persist the SCRATCH draft as it changes (cleared on a successful save). In
  // edit mode the text IS a file's content, not the scratch note — don't let it
  // overwrite the persisted draft, so the scratch survives an edit session.
  useEffect(() => {
    if (editTarget) return;
    try {
      if (text) localStorage.setItem(DRAFT_KEY, text);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }, [text, editTarget]);

  const clear = useCallback(() => setText(""), []);

  // Enter edit mode: load a file's raw content (frontmatter and all), leaving the
  // scratch draft untouched in storage.
  const openEdit = useCallback(
    (t: { kind: string; ref: string; title: string; content: string }) => {
      setEditTarget({ kind: t.kind, ref: t.ref, title: t.title });
      setText(t.content);
      setOpen(true);
    },
    []
  );

  // Leave edit mode → restore the scratch draft that was set aside.
  const closeEdit = useCallback(() => {
    setEditTarget(null);
    try {
      setText(localStorage.getItem(DRAFT_KEY) ?? "");
    } catch {
      setText("");
    }
  }, []);

  return (
    <TextEditorContext.Provider
      value={{
        open,
        setOpen,
        toggle: () => setOpen((v) => !v),
        text,
        setText,
        clear,
        editTarget,
        openEdit,
        closeEdit,
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
      editTarget: null,
      openEdit: () => {},
      closeEdit: () => {},
    }
  );
}
