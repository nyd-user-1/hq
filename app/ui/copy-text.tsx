"use client";

import { useState } from "react";

// Click-to-copy text (a file path, a resume command). The pointer cursor + a
// brief emerald flash are the whole affordance — no tooltip. The label never
// changes, so nothing reflows.
export default function CopyText({
  text,
  children,
  className = "",
}: {
  text: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
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
