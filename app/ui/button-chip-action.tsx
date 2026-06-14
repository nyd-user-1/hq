"use client";

// A "+ label" text chip styled as a zinc-800 button — the send box's quick
// actions (+ attach, + todo). Presentational: a `label` (the "+ " is the
// component's signature), an `accent` text color, and `onClick`. The two send-box
// chips are just two accents of this one component.
export default function ButtonChipAction({
  label,
  onClick,
  accent = "text-zinc-100",
  title,
  ariaLabel,
}: {
  label: string;
  onClick: () => void;
  accent?: string;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`shrink-0 cursor-pointer rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:bg-zinc-700 ${accent}`}
    >
      + {label}
    </button>
  );
}
