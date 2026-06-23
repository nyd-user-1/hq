"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTextEditor } from "@/app/ui/text-editor-state";

// Editable kinds — mirrors the ⌘K reader's canEdit (memory notes, HQ notes,
// repo .md). Keep in sync with /api/file-edit's accepted kinds.
function editable(kind: string, refId: string) {
  return (
    kind === "memory" ||
    kind === "note" ||
    (kind === "file" && refId.endsWith(".md"))
  );
}

// The /search panel reader's floating action cluster — parity with the ⌘K
// reader's top-right icons: an Edit pencil (editable kinds only) + a
// copy-contents button. The open-in-panel icon is intentionally dropped — we're
// already IN the panel, so it would be a no-op.
//
// The /search readers are SERVER-rendered, so after the Text editor writes the
// file back (it fires hq:file-edited on save) we router.refresh() to re-render
// the reader with the new content — the client-side equivalent of the ⌘K
// reader's editNonce re-fetch.
export default function ReaderActions({
  kind,
  refId,
  title,
  text,
}: {
  kind: string;
  refId: string;
  title: string;
  text: string;
}) {
  const { openEdit } = useTextEditor();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const canEdit = editable(kind, refId);

  useEffect(() => {
    const onEdited = () => router.refresh();
    window.addEventListener("hq:file-edited", onEdited);
    return () => window.removeEventListener("hq:file-edited", onEdited);
  }, [router]);

  // Pencil → fetch the RAW file (frontmatter and all) and open it in the shared
  // Text editor in edit mode, exactly like the ⌘K reader's pencil.
  const onEdit = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/file-edit?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(refId)}`
      );
      if (!res.ok) return;
      const d = await res.json();
      openEdit({
        kind,
        ref: refId,
        title,
        content: typeof d?.content === "string" ? d.content : "",
      });
    } catch {
      /* leave the reader as-is on a fetch error */
    }
  }, [kind, refId, title, openEdit]);

  if (!canEdit && !text) return null;

  return (
    <div className="absolute right-2 top-1 z-10 flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/90 px-1.5 py-1">
      {canEdit && (
        <>
          <button
            onClick={onEdit}
            aria-label="Edit file"
            title="Edit file"
            className="flex shrink-0 items-center rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
          >
            {/* lucide pencil */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
          <span className="h-3.5 w-px bg-zinc-800" />
        </>
      )}
      <button
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        aria-label="Copy contents"
        title="Copy contents"
        className={`flex shrink-0 items-center rounded p-0.5 transition-colors hover:text-zinc-200 ${
          copied ? "text-emerald-400" : "text-zinc-500"
        }`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {copied ? (
            <path d="M20 6 9 17l-5-5" />
          ) : (
            <>
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
