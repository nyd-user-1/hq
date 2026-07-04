"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// Open-tab state for the Docs surface (docs.tsx) — the document editor that
// renders as a pane view (@docs), co-equal with the terminal. Lives at the
// SHELL level (like every panel state) so tabs + unsaved edits survive the
// pane mounting/unmounting/moving between Terminal 1 and the wall.
//
// A tab holds one file: an HQ document (~/.claude/hq/documents), a memory
// note, an HQ note, or a repo .md — the same kinds /api/file-edit serves.
// Content is the RAW file (frontmatter and all); docs.tsx decides how to
// present it (rich ProseMirror body + title field for documents, source
// fallback for anything odd).

export type DocTabKind = "document" | "memory" | "note" | "file";

export type DocTab = {
  id: string; // `${kind}:${ref}` — stable identity
  kind: DocTabKind;
  ref: string; // the ref /api/file-edit accepts
  title: string;
  /** raw file content; null = not loaded yet (restored tab awaiting fetch) */
  content: string | null;
  /** last-saved content — dirty = content !== savedContent */
  savedContent: string | null;
  readOnly: boolean;
  /** rich = ProseMirror WYSIWYG; source = raw markdown textarea */
  mode: "rich" | "source";
};

export const docTabId = (kind: string, ref: string) => `${kind}:${ref}`;

type Ctx = {
  tabs: DocTab[];
  activeId: string | null;
  /** open (or just focus) a tab; bumps revealNonce so the @docs pane surfaces */
  openDoc: (t: {
    kind: DocTabKind;
    ref: string;
    title: string;
    content?: string;
    readOnly?: boolean;
  }) => void;
  /** focus a tab; null shows the library (documents index) with tabs kept */
  activate: (id: string | null) => void;
  closeTab: (id: string) => void;
  setContent: (id: string, content: string) => void;
  setTitle: (id: string, title: string) => void;
  setMode: (id: string, mode: "rich" | "source") => void;
  /** mark a restored tab as loaded (content + savedContent from disk) */
  hydrate: (id: string, content: string) => void;
  saveTab: (id: string) => Promise<void>;
  /** any tabs open — the sidebar item's activity cue */
  docsOpen: boolean;
  /** bumped by every openDoc — docs-reveal.tsx watches it to surface the pane */
  revealNonce: number;
};

const DocsContext = createContext<Ctx | null>(null);

// Persisted shape — tabs survive a refresh. Clean tabs re-fetch their content
// on restore (null); dirty tabs carry BOTH sides so unsaved edits survive.
const STORE_KEY = "hq-docs-tabs";
type StoredTab = {
  kind: DocTabKind;
  ref: string;
  title: string;
  readOnly: boolean;
  mode: "rich" | "source";
  content?: string; // only persisted while dirty
  savedContent?: string;
};

export function DocsProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<DocTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [revealNonce, setRevealNonce] = useState(0);
  const restored = useRef(false);

  // Restore the tab strip once on mount.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        tabs?: StoredTab[];
        activeId?: string | null;
      };
      if (!Array.isArray(saved.tabs) || saved.tabs.length === 0) return;
      const restoredTabs: DocTab[] = saved.tabs.map((t) => ({
        id: docTabId(t.kind, t.ref),
        kind: t.kind,
        ref: t.ref,
        title: t.title,
        content: typeof t.content === "string" ? t.content : null,
        savedContent: typeof t.savedContent === "string" ? t.savedContent : null,
        readOnly: !!t.readOnly,
        mode: t.mode === "source" ? "source" : "rich",
      }));
      setTabs(restoredTabs);
      setActiveId(
        saved.activeId && restoredTabs.some((t) => t.id === saved.activeId)
          ? saved.activeId
          : (restoredTabs[0]?.id ?? null)
      );
    } catch {
      /* corrupted store — start clean */
    }
  }, []);

  // Persist on every change (meta always; content only while dirty).
  useEffect(() => {
    if (!restored.current) return;
    try {
      if (tabs.length === 0) {
        localStorage.removeItem(STORE_KEY);
        return;
      }
      const stored: StoredTab[] = tabs.map((t) => {
        const dirty =
          t.content != null && t.savedContent != null && t.content !== t.savedContent;
        return {
          kind: t.kind,
          ref: t.ref,
          title: t.title,
          readOnly: t.readOnly,
          mode: t.mode,
          ...(dirty
            ? { content: t.content ?? undefined, savedContent: t.savedContent ?? undefined }
            : {}),
        };
      });
      localStorage.setItem(STORE_KEY, JSON.stringify({ tabs: stored, activeId }));
    } catch {
      /* storage full/blocked — tabs just won't survive a refresh */
    }
  }, [tabs, activeId]);

  const openDoc = useCallback(
    (t: {
      kind: DocTabKind;
      ref: string;
      title: string;
      content?: string;
      readOnly?: boolean;
    }) => {
      const id = docTabId(t.kind, t.ref);
      setTabs((prev) => {
        if (prev.some((x) => x.id === id)) return prev; // focus only — never clobber edits
        return [
          ...prev,
          {
            id,
            kind: t.kind,
            ref: t.ref,
            title: t.title,
            content: t.content ?? null,
            savedContent: t.content ?? null,
            readOnly: !!t.readOnly,
            mode: "rich",
          },
        ];
      });
      setActiveId(id);
      setRevealNonce((n) => n + 1);
    },
    []
  );

  const activate = useCallback((id: string | null) => setActiveId(id), []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const i = prev.findIndex((t) => t.id === id);
      if (i === -1) return prev;
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) =>
        cur === id ? (next[Math.min(i, next.length - 1)]?.id ?? null) : cur
      );
      return next;
    });
  }, []);

  const patch = useCallback((id: string, p: Partial<DocTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }, []);

  const setContent = useCallback(
    (id: string, content: string) => patch(id, { content }),
    [patch]
  );
  const setTitle = useCallback(
    (id: string, title: string) => patch(id, { title }),
    [patch]
  );
  const setMode = useCallback(
    (id: string, mode: "rich" | "source") => patch(id, { mode }),
    [patch]
  );
  const hydrate = useCallback(
    (id: string, content: string) =>
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                // a restored DIRTY tab keeps its edits; only fill the blanks
                content: t.content ?? content,
                savedContent: t.savedContent ?? content,
              }
            : t
        )
      ),
    []
  );

  // Write the tab's raw content back through /api/file-edit and tell every
  // reader (⌘K, /search panel) the file changed — the same contract the old
  // text-editor panel kept.
  const saveTab = useCallback(
    async (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab || tab.readOnly || tab.content == null) return;
      const content = tab.content;
      const res = await fetch("/api/file-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: tab.kind, ref: tab.ref, content }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      patch(id, { savedContent: content });
      window.dispatchEvent(
        new CustomEvent("hq:file-edited", {
          detail: { kind: tab.kind, ref: tab.ref },
        })
      );
    },
    [tabs, patch]
  );

  return (
    <DocsContext.Provider
      value={{
        tabs,
        activeId,
        openDoc,
        activate,
        closeTab,
        setContent,
        setTitle,
        setMode,
        hydrate,
        saveTab,
        docsOpen: tabs.length > 0,
        revealNonce,
      }}
    >
      {children}
    </DocsContext.Provider>
  );
}

export function useDocs(): Ctx {
  return (
    useContext(DocsContext) ?? {
      tabs: [],
      activeId: null,
      openDoc: () => {},
      activate: () => {},
      closeTab: () => {},
      setContent: () => {},
      setTitle: () => {},
      setMode: () => {},
      hydrate: () => {},
      saveTab: async () => {},
      docsOpen: false,
      revealNonce: 0,
    }
  );
}
