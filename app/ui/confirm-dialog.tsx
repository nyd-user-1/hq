"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// A reusable two-step guard for destructive actions — the standard "are you sure?"
// modal. HQ's first shared confirm primitive (todo's Clear completed was a passive
// one-click that once wiped the list); reach for this before any delete/clear/
// overwrite of user data. Portals to <body>; Escape or a backdrop click cancels;
// Cancel is focused by default so a stray Enter is safe; the confirm button is
// styled destructive (red), never as a passive label.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus(); // safe default — a stray Enter cancels, not deletes
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-2xl"
      >
        <h2 className="font-mono text-sm font-semibold text-zinc-100">{title}</h2>
        {message && (
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">{message}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-md border border-zinc-700 px-3 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-red-500/90 px-3 py-1.5 font-mono text-xs font-medium text-white transition-colors hover:bg-red-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
