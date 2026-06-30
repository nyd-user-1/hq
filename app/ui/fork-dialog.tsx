"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

// Full-screen acknowledgement at the read-only → write moment: hq is about to take
// the wheel on a session a Claude Code terminal owns, which FORKS it from the
// current transcript. Reuses the ⌘K modal pattern (backdrop + centered card +
// pop-in) and portals to <body> so a pane never clips it. ↵ confirms, esc cancels.
export default function ForkDialog({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onConfirm(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onConfirm, onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div
        onClick={onCancel}
        style={{ animation: "cmdk-backdrop-in 130ms ease-out" }}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{ animation: "cmdk-pop-in 170ms cubic-bezier(0.16, 1, 0.3, 1)" }}
        className="relative w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-950 p-5 font-mono shadow-2xl"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          {/* lucide git-branch — this is a fork */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-400" aria-hidden>
            <line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          Continue this session in hq
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-400">
          This session is being written in a{" "}
          <span className="text-zinc-200">terminal</span>. For a clean hand-off,{" "}
          <span className="text-zinc-200">close the terminal first</span> — hq then
          continues it from the last turn, same id, one thread. Leave it open and
          write in both and the transcript{" "}
          <span className="text-amber-300">branches</span>.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
          >
            Cancel <span className="text-zinc-600">esc</span>
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border border-emerald-600/50 bg-emerald-600/15 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-600/25"
          >
            Continue here <span className="text-emerald-500/70">↵</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
