"use client";

// The one and only switch — an on/off toggle, emerald when on, role="switch". hq's
// single on/off control (Plugins enable/disable today; it may drive different
// actions elsewhere, but the UI is settled). Do NOT write a second switch
// component — import this one.
export default function Switch({
  on,
  onClick,
  disabled,
  title,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full ring-1 transition-colors disabled:opacity-50 ${
        on ? "bg-emerald-500 ring-emerald-400" : "bg-zinc-600 ring-zinc-500"
      }`}
    >
      <span className={`inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-[15px]" : "translate-x-0.5"}`} />
    </button>
  );
}
