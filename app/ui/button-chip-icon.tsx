"use client";

import type { ReactNode } from "react";

// A small square icon button styled as a zinc-800 chip — the shared affordance
// behind the boundary/header controls (sidebar toggle, search trigger, the app
// panel's expand + close). Presentational: pass an SVG `icon`, an `label` for
// screen readers, and `onClick`. `active` swaps to the lit state (e.g. the
// search trigger while the Search panel is open). `className` carries per-site
// extras like `shrink-0` or `boundary-flash-chip`.
export default function ButtonChipIcon({
  icon,
  label,
  onClick,
  active = false,
  title,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title}
      className={`flex cursor-pointer items-center px-1.5 py-0.5 transition-colors ${
        active
          ? "bg-zinc-700 text-zinc-200"
          : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
      } ${className}`}
    >
      {icon}
    </button>
  );
}
