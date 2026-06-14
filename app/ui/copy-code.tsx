"use client";

import { useState } from "react";

// Inline `code` chips in Claude's replies, made click-to-copy — grab a commit
// hash, command, or class name straight from a message. Flashes green on copy
// without swapping the text, so the sentence never reflows. `copyText` lets the
// copied value differ from the shown one (e.g. display a short session id, copy
// the full uuid).
export default function CopyCode({
  children,
  copyText,
}: {
  children: string;
  copyText?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <code
      onClick={() => {
        navigator.clipboard.writeText(copyText ?? children);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`cursor-pointer rounded px-1 py-0.5 text-[0.95em] transition-colors ${
        copied
          ? "bg-emerald-500/15 text-emerald-300"
          : "bg-zinc-800 text-violet-300 hover:bg-zinc-700"
      }`}
    >
      {children}
    </code>
  );
}
