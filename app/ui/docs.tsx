"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import ProseMirrorEditor from "@/app/ui/prosemirror-editor";
import { useDocs, type DocTab, type DocTabKind } from "@/app/ui/docs-state";
import {
  splitFrontmatter,
  joinFrontmatter,
  withFmTitle,
} from "@/app/ui/doc-frontmatter";

// The Docs surface — hq's document editor, co-equal with the terminal. Renders
// as a pane view (?session=@docs fills Terminal 1; "@docs" on ?wall sits beside
// a live session). Linear-shaped: a tab strip (every open file), a big editable
// title over a ProseMirror body, a footer with live counts + save. No tab open
// = the library (the documents index + New doc).
//
// A tab edits any /api/file-edit kind: hq documents (their own store,
// ~/.claude/hq/documents), memory notes, hq notes, repo .md. The frontmatter
// block is preserved verbatim (only a document's title line is editable, via
// the title field); ProseMirror round-trips the BODY as markdown. The `source`
// mode is the escape hatch — the raw file in a textarea, frontmatter and all.

type DocumentRow = {
  name: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  session?: string;
};

const KIND_LABEL: Record<DocTabKind, string> = {
  document: "doc",
  memory: "memory",
  note: "note",
  file: "file",
};

function fmtAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const isDirty = (t: DocTab) =>
  t.content != null && t.savedContent != null && t.content !== t.savedContent;

export default function DocsView() {
  const docs = useDocs();
  const params = useSearchParams();
  const {
    tabs,
    activeId,
    activate,
    openDoc,
    closeTab,
    setContent,
    setTitle,
    setMode,
    hydrate,
    saveTab,
  } = docs;
  const active = tabs.find((t) => t.id === activeId) ?? null;
  const [status, setStatus] = useState<{ id: string; kind: "saved" | "error"; msg?: string } | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Provenance for new docs: the session pinned in T1 (a real one, not a view).
  const ses = params.get("session");
  const sessionId = ses && !ses.startsWith("@") && ses !== "new" ? ses : undefined;

  // Lazy-load a restored tab's content the first time it's looked at.
  useEffect(() => {
    if (!active || active.content != null) return;
    let gone = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/file-edit?kind=${encodeURIComponent(active.kind)}&ref=${encodeURIComponent(active.ref)}`
        );
        if (!res.ok || gone) return;
        const d = await res.json();
        if (typeof d?.content === "string") hydrate(active.id, d.content);
      } catch {
        /* stays "loading…" — a retry is one tab-switch away */
      }
    })();
    return () => {
      gone = true;
    };
  }, [active, hydrate]);

  const flash = useCallback((s: NonNullable<typeof status>) => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatus(s);
    if (s.kind === "saved")
      statusTimer.current = setTimeout(() => setStatus(null), 1600);
  }, []);

  const save = useCallback(
    async (id: string | null) => {
      if (!id) return;
      const tab = tabs.find((t) => t.id === id);
      if (!tab || tab.readOnly || !isDirty(tab)) return;
      try {
        await saveTab(id);
        flash({ id, kind: "saved" });
      } catch (e) {
        flash({ id, kind: "error", msg: e instanceof Error ? e.message : String(e) });
      }
    },
    [tabs, saveTab, flash]
  );

  const requestClose = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      if (isDirty(tab) && !window.confirm(`Close "${tab.title}" with unsaved changes?`))
        return;
      closeTab(id);
    },
    [tabs, closeTab]
  );

  // New doc → create in the store, open its tab. Content is what we just wrote,
  // fetched back so the tab starts in sync with disk.
  const newDoc = useCallback(async () => {
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Untitled", sessionId }),
      });
      if (!res.ok) return;
      const { name } = await res.json();
      const g = await fetch(`/api/file-edit?kind=document&ref=${encodeURIComponent(name)}`);
      const content = g.ok ? ((await g.json())?.content ?? "") : "";
      openDoc({ kind: "document", ref: name, title: "Untitled", content });
    } catch {
      /* store unreachable — nothing to open */
    }
  }, [openDoc, sessionId]);

  // Container-level keys: ⌘S saves (the title field / source textarea don't have
  // ProseMirror's keymap), esc closes the active tab.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save(activeId);
      } else if (e.key === "Escape" && activeId) {
        e.preventDefault();
        requestClose(activeId);
      }
    },
    [activeId, save, requestClose]
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={onKeyDown}
    >
      {/* ---- tab strip -------------------------------------------------- */}
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 scrollbar-none">
        <button
          type="button"
          onClick={() => activate(null)}
          title="Documents library"
          aria-label="Documents library"
          className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] transition-colors ${
            !active ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {/* lucide library */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m16 6 4 14" />
            <path d="M12 6v14" />
            <path d="M8 8v12" />
            <path d="M4 4v16" />
          </svg>
          docs
        </button>
        <span className="h-4 w-px shrink-0 bg-zinc-800" />
        {tabs.map((t) => {
          const dirty = isDirty(t);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => activate(t.id)}
              title={`${t.title} · ${KIND_LABEL[t.kind]}`}
              className={`group/tab flex max-w-[180px] shrink-0 items-center gap-1.5 rounded px-2 py-1 font-mono text-[11px] transition-colors ${
                t.id === activeId
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {dirty && (
                <span
                  className="shrink-0 text-orange-400"
                  title="unsaved changes"
                >
                  ·
                </span>
              )}
              <span className="truncate">{t.title || "untitled"}</span>
              <span
                role="button"
                aria-label={`close ${t.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  requestClose(t.id);
                }}
                className="shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-200 group-hover/tab:opacity-100"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={newDoc}
          title="New doc"
          aria-label="New doc"
          className="flex shrink-0 items-center rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* ---- body -------------------------------------------------------- */}
      {active ? (
        <DocEditor
          key={active.id}
          tab={active}
          onBody={(fm, md) => setContent(active.id, joinFrontmatter(fm, md))}
          onRaw={(raw) => setContent(active.id, raw)}
          onTitle={(v) => {
            setTitle(active.id, v);
            const { fm, body } = splitFrontmatter(active.content ?? "");
            setContent(active.id, joinFrontmatter(withFmTitle(fm, v), body));
          }}
          onSave={() => save(active.id)}
        />
      ) : (
        <DocsLibrary onOpen={openDoc} onNew={newDoc} />
      )}

      {/* ---- footer ------------------------------------------------------ */}
      {active && (
        <DocFooter
          tab={active}
          status={status?.id === active.id ? status : null}
          onSave={() => save(active.id)}
          onMode={(m) => setMode(active.id, m)}
          onDeleted={() => closeTab(active.id)}
        />
      )}
    </div>
  );
}

// ---- the editor pane (title + body) ----------------------------------------

function DocEditor({
  tab,
  onBody,
  onRaw,
  onTitle,
  onSave,
}: {
  tab: DocTab;
  onBody: (fm: string | null, markdown: string) => void;
  onRaw: (raw: string) => void;
  onTitle: (title: string) => void;
  onSave: () => void;
}) {
  if (tab.content == null) {
    return (
      <p className="flex flex-1 items-center justify-center font-mono text-xs text-zinc-600">
        loading {tab.title}…
      </p>
    );
  }
  const { fm, body } = splitFrontmatter(tab.content);

  if (tab.mode === "source") {
    return (
      <textarea
        value={tab.content}
        onChange={(e) => onRaw(e.target.value)}
        readOnly={tab.readOnly}
        spellCheck={false}
        className="scrollbar-none min-h-0 w-full flex-1 resize-none bg-transparent px-5 py-4 font-mono text-[12.5px] leading-relaxed text-zinc-200 focus:outline-none"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-none">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pt-5">
        {tab.kind === "document" && !tab.readOnly ? (
          <input
            value={tab.title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="Untitled"
            aria-label="Document title"
            className="w-full shrink-0 bg-transparent text-2xl font-semibold tracking-tight text-zinc-100 placeholder:text-zinc-700 focus:outline-none"
          />
        ) : (
          <h1 className="shrink-0 truncate text-2xl font-semibold tracking-tight text-zinc-100">
            {tab.title}
            {tab.readOnly && (
              <span className="ml-3 align-middle font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-zinc-600">
                read only
              </span>
            )}
          </h1>
        )}
        <p className="mt-1 shrink-0 font-mono text-[10px] text-zinc-600">
          {KIND_LABEL[tab.kind]} · {tab.ref}
        </p>
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <ProseMirrorEditor
            key={tab.mode}
            value={body}
            onChange={(md) => onBody(fm, md)}
            readOnly={tab.readOnly}
            onSave={onSave}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}

// ---- footer -----------------------------------------------------------------

function DocFooter({
  tab,
  status,
  onSave,
  onMode,
  onDeleted,
}: {
  tab: DocTab;
  status: { kind: "saved" | "error"; msg?: string } | null;
  onSave: () => void;
  onMode: (m: "rich" | "source") => void;
  onDeleted: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dirty = isDirty(tab);

  const stats = useMemo(() => {
    const { body } = splitFrontmatter(tab.content ?? "");
    const trimmed = body.trim();
    return {
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      chars: body.length,
      lines: body ? body.split("\n").length : 0,
    };
  }, [tab.content]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const del = async () => {
    if (tab.kind !== "document") return;
    if (!window.confirm(`Delete "${tab.title}"? This removes the file.`)) return;
    try {
      const res = await fetch(
        `/api/documents?name=${encodeURIComponent(tab.ref)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        window.dispatchEvent(
          new CustomEvent("hq:file-edited", {
            detail: { kind: "document", ref: tab.ref },
          })
        );
        onDeleted();
      }
    } catch {
      /* leave the tab open */
    }
  };

  return (
    <div className="flex h-9 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-1 pt-1.5">
      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
        {status?.kind === "error" ? (
          <span className="normal-case tracking-normal text-red-400">
            save failed — {status.msg}
          </span>
        ) : status?.kind === "saved" ? (
          <span className="text-emerald-400">saved ✓</span>
        ) : (
          <span>
            {stats.words} words · {stats.chars} chars · {stats.lines} lines
            {dirty && <span className="ml-2 text-orange-400">unsaved</span>}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* rich ⇄ source */}
        <div className="flex items-center rounded border border-zinc-800 font-mono text-[10px]">
          {(["rich", "source"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              className={`px-2 py-0.5 transition-colors ${
                tab.mode === m
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <span className="hidden font-mono text-[10px] text-zinc-600 lg:inline">
          ⌘S save · esc close
        </span>

        {tab.readOnly ? (
          <span className="rounded border border-zinc-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            read only
          </span>
        ) : (
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty}
            className="rounded-md bg-orange-500/90 px-3 py-1 font-mono text-[11px] font-medium text-zinc-950 transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            save
          </button>
        )}

        {/* doc ⋯ menu */}
        <div className="relative">
          <button
            type="button"
            aria-label="Doc actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-full right-0 z-50 mb-1 flex w-48 flex-col whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
            >
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(tab.content ?? "");
                  setMenuOpen(false);
                }}
                className="rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
              >
                Copy markdown
              </button>
              {tab.kind === "document" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `~/.claude/hq/documents/${tab.ref}`
                      );
                      setMenuOpen(false);
                    }}
                    className="rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
                  >
                    Copy path
                  </button>
                  <div className="my-1 h-px bg-zinc-800" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      del();
                    }}
                    className="rounded px-2 py-1.5 text-left text-xs text-red-400 transition-colors hover:bg-zinc-900"
                  >
                    Delete doc
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- the library (no tab focused) -------------------------------------------

function DocsLibrary({
  onOpen,
  onNew,
}: {
  onOpen: (t: {
    kind: DocTabKind;
    ref: string;
    title: string;
    content?: string;
  }) => void;
  onNew: () => void;
}) {
  const [rows, setRows] = useState<DocumentRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) return;
      const d = await res.json();
      if (Array.isArray(d?.documents)) setRows(d.documents);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
    const onEdited = () => load();
    window.addEventListener("hq:file-edited", onEdited);
    return () => window.removeEventListener("hq:file-edited", onEdited);
  }, [load]);

  const open = async (row: DocumentRow) => {
    try {
      const res = await fetch(
        `/api/file-edit?kind=document&ref=${encodeURIComponent(row.name)}`
      );
      const content = res.ok ? ((await res.json())?.content ?? "") : undefined;
      onOpen({ kind: "document", ref: row.name, title: row.title, content });
    } catch {
      onOpen({ kind: "document", ref: row.name, title: row.title });
    }
  };

  const del = async (row: DocumentRow) => {
    if (!window.confirm(`Delete "${row.title}"? This removes the file.`)) return;
    try {
      const res = await fetch(`/api/documents?name=${encodeURIComponent(row.name)}`, {
        method: "DELETE",
      });
      if (res.ok) setRows((r) => (r ?? []).filter((x) => x.name !== row.name));
    } catch {
      /* row stays */
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-none">
      <div className="mx-auto w-full max-w-3xl px-5 pt-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Documents
          </h1>
          <button
            type="button"
            onClick={onNew}
            className="rounded-md bg-orange-500/90 px-3 py-1 font-mono text-[11px] font-medium text-zinc-950 transition-colors hover:bg-orange-400"
          >
            + new doc
          </button>
        </div>
        <p className="mt-1 font-mono text-[11px] text-zinc-500">
          Living pages in <span className="text-zinc-400">~/.claude/hq/documents</span> —
          write here, or send any block over via its ⋮ → Open in Doc.
        </p>

        {rows == null ? (
          <p className="mt-8 font-mono text-xs text-zinc-600">loading…</p>
        ) : rows.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-zinc-800 p-6 text-center">
            <p className="font-mono text-xs text-zinc-500">
              No documents yet.
            </p>
            <p className="mt-1.5 font-mono text-[11px] text-zinc-600">
              Hit <span className="text-zinc-400">+ new doc</span>, or open any
              terminal block in here from its ⋮ menu.
            </p>
          </div>
        ) : (
          <ul className="mt-5 flex flex-col">
            {rows.map((row) => (
              <li
                key={row.name}
                className="group/row flex items-center gap-3 border-b border-zinc-800/60 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => open(row)}
                  className="flex min-w-0 flex-1 items-baseline gap-3 text-left"
                >
                  <span className="truncate text-sm font-medium text-zinc-200 transition-colors group-hover/row:text-zinc-50">
                    {row.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                    {fmtAgo(row.updatedAt)}
                    {row.session ? ` · via ${row.session.slice(0, 8)}` : ""}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`delete ${row.title}`}
                  title="Delete doc"
                  onClick={() => del(row)}
                  className="shrink-0 rounded p-1 text-zinc-700 opacity-0 transition hover:bg-zinc-800 hover:text-red-400 group-hover/row:opacity-100"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
