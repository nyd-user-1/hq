"use client";

import type { ButtonHTMLAttributes } from "react";

// hq's standard action button. Two looks, one component:
//   • "plain"   — borderless text; the card action (Install / card Run).
//   • "outline" — bordered; the detail-header action (Run / Apply).
// The label swaps on state at the call site; this owns the look. Spreads native
// button props so it drops in for a raw <button>. Don't hand-roll another.
type Variant = "plain" | "outline";

const VARIANTS: Record<Variant, string> = {
  plain: "px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
  outline:
    "border border-zinc-700 px-2.5 py-1 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100",
};

export default function Button({
  variant = "plain",
  className = "",
  type = "button",
  children,
  ...rest
}: { variant?: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`shrink-0 rounded-md font-mono text-[11px] transition-colors disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
