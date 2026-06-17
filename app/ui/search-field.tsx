"use client";

import type { KeyboardEvent, Ref } from "react";

// A generic controlled search box — value / onChange / placeholder. The caller
// owns the query state and does the filtering, so it drops into any list. This
// is the reusable primitive; SearchInput is the route-coupled instance that
// drives the global /search page (it could be rebuilt on this).
export default function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  className = "",
  inputRef,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  // Optional, additive — existing call sites are unaffected. Lets a caller focus
  // the box imperatively (e.g. an expanding header search) and intercept keys
  // (Escape-to-close).
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoComplete="off"
      className={`w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none ${className}`}
    />
  );
}
