"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SearchScope } from "@/lib/search";
import { SCOPE_TAGS, scopeLabel } from "@/app/ui/search-tags";

// The Search "Filter" control — the same pattern as the Components panel's kind
// filter (a model-button trigger opening a chip menu bottom-left), but over the
// 13 search scopes. Replaces the old wrap-around row of scope chips: the active
// scope rides on the button face, the rest live in the dropdown. Each item is a
// pin-carrying <Link> (nav re-renders the server page at the new scope), so this
// stays a thin client shell around the existing URL-driven scope.
export default function SearchScopeFilter({
  scope,
  q,
  sort,
  pins,
}: {
  scope: SearchScope;
  q: string;
  sort: string;
  pins: string; // the "session=…&pair=…" tail, "" when unpinned
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape (same as the Components filter).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const tail = pins ? `&${pins}` : "";
  const hrefFor = (value: SearchScope) =>
    `/search?q=${encodeURIComponent(q)}&scope=${value}&sort=${sort}${tail}`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="filter by corpus"
        aria-label="Filter by corpus"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex max-w-full items-center rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
      >
        <span className="truncate">{scopeLabel(scope)}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="scrollbar-none absolute left-0 top-full z-30 mt-1 flex max-h-[60vh] w-48 flex-col overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
        >
          {SCOPE_TAGS.map((s) => (
            <Link
              key={s.value}
              role="menuitem"
              href={hrefFor(s.value)}
              scroll={false}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
            >
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${s.chip}`}
              >
                {s.label}
              </span>
              {scope === s.value && (
                <span className="ml-auto text-xs text-blue-400">✓</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
