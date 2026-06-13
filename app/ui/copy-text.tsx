"use client";

import { useState } from "react";

// Click-to-copy text (a file path, a resume command). The pointer cursor + a
// brief emerald flash are the whole affordance — no tooltip. The label never
// changes, so nothing reflows.
export default function CopyText({
  text,
  children,
  className = "",
  title,
}: {
  text: string;
  children: React.ReactNode;
  className?: string;
  // Optional tooltip — off by default (text/path usages stay tooltip-free); set
  // it for icon-only buttons where the action isn't self-evident.
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`cursor-pointer text-left transition-colors ${
        copied ? "text-emerald-300" : ""
      } ${className}`}
    >
      {children}
    </button>
  );
}
