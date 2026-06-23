"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

// The general-purpose button hq was missing — 131 inline <button>s across 18
// files reinvented this. The chip buttons (ButtonChipIcon / ButtonChipAction)
// stay for the boundary + send-box affordances; this is everything else. Spreads
// native button props so it drops in for a raw <button>. Styling rides the
// semantic tokens (globals.css @theme): bg-surface-2/3, bg-accent, bg-danger.

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:opacity-90",
  secondary: "bg-surface-2 text-zinc-100 hover:bg-surface-3",
  ghost: "bg-transparent text-zinc-400 hover:bg-surface-2 hover:text-zinc-100",
  danger: "bg-danger text-white hover:opacity-90",
};

const SIZES: Record<Size, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export default function Button({
  variant = "secondary",
  size = "md",
  leftIcon,
  className = "",
  type = "button",
  children,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {leftIcon}
      {children}
    </button>
  );
}
