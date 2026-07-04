"use client";

// The filter chip — a rounded {label · count} toggle that filters a list by one
// facet. ONE component for every facet across the console members: source (agents,
// commands, output styles, skills), category (plugins), scope (mcp). The facet is
// just the data you feed it; `truncate` clips long labels (mcp server names). This
// replaced the byte-identical SrcChip / CatChip / ScopeChip copies.
export default function FilterChip({
  label,
  count,
  active,
  onClick,
  truncate = false,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  // clip an over-long label (mcp server names) — the one real difference the old
  // ScopeChip carried.
  truncate?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
        active
          ? "border-zinc-200 bg-zinc-200 text-zinc-900"
          : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
      }`}
    >
      <span className={truncate ? "max-w-[120px] truncate" : ""}>{label}</span>
      <span className={`tabular-nums ${active ? "text-zinc-500" : "text-zinc-600"}`}>{count}</span>
    </button>
  );
}
