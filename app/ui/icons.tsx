import type { ReactNode } from "react";

// The icon set hq was missing — 102 inline <svg>s across 27 files redraw the same
// Lucide-style glyphs. One source per glyph here; render with <Icon name="copy" />.
// Stroke icons on a 24-grid (currentColor, width 2), matching the existing inline
// SVGs so call sites swap 1:1. Seeded with the highest-frequency glyphs; add more
// as the inline ones get migrated.

export type IconName =
  | "kebab"
  | "close"
  | "chevron-down"
  | "chevron-right"
  | "copy"
  | "check"
  | "search"
  | "plus"
  | "star"
  | "file-text"
  | "file-code"
  | "eye-off";

// Glyphs that read as solid fills rather than strokes (e.g. the kebab dots).
const FILLED: Partial<Record<IconName, boolean>> = { kebab: true };

const PATHS: Record<IconName, ReactNode> = {
  kebab: (
    <>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  copy: (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  plus: <path d="M5 12h14M12 5v14" />,
  star: <path d="M12 2l2.9 6.3 6.8.8-5 4.6 1.3 6.7L12 17.8 5.7 21l1.3-6.7-5-4.6 6.8-.8z" />,
  "file-text": (
    <>
      <path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M15 3v5h5" />
      <path d="M8 13h6M8 17h4" />
    </>
  ),
  "file-code": (
    <>
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="m10 13-2 2 2 2" />
      <path d="m14 13 2 2-2 2" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="m2 2 20 20" />
    </>
  ),
};

export default function Icon({
  name,
  size = 16,
  className = "",
  fill,
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  className?: string;
  fill?: string;
  strokeWidth?: number;
}) {
  const f = fill ?? (FILLED[name] ? "currentColor" : "none");
  const stroke = f === "none" ? "currentColor" : "none";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={f}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
