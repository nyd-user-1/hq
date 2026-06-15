"use client";

// A generic controlled search box — value / onChange / placeholder. The caller
// owns the query state and does the filtering, so it drops into any list. This
// is the reusable primitive; SearchInput is the route-coupled instance that
// drives the global /search page (it could be rebuilt on this).
export default function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      className={`w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none ${className}`}
    />
  );
}
