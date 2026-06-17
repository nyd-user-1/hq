"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import SearchField from "@/app/ui/search-field";
import type { Ship } from "@/lib/shipped";

// The commit feed, client-side so search + the project filter narrow it live.
// Header model (matches To Do / Components): a full-width SearchField, then a
// control row with the "Filter" (by project/repo) on the RIGHT, its dropdown
// opening bottom-right. No sort, no "+". Each row IS the Skills row — green dot
// (a landed commit) · sha · subject · repo; a row opens that commit's diff
// in-panel, the href carrying the terminal pins (pinTail). The "*Click a commit…"
// caption lives in a footer on the page (outside this scroll area).
export default function ShippedFeed({
  ships,
  pinTail,
}: {
  ships: Ship[];
  pinTail: string;
}) {
  const [q, setQ] = useState("");
  const [repo, setRepo] = useState<string | null>(null); // active project filter
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const repos = useMemo(
    () => [...new Set(ships.map((s) => s.repo))].sort(),
    [ships]
  );

  // Close the project-filter dropdown on an outside click or Escape.
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node))
        setFilterOpen(false);
    };
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setFilterOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ships.filter((s) => {
      if (repo && s.repo !== repo) return false;
      if (!needle) return true;
      return (
        s.sha.toLowerCase().includes(needle) ||
        s.subject.toLowerCase().includes(needle) ||
        s.repo.toLowerCase().includes(needle)
      );
    });
  }, [ships, q, repo]);

  return (
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="sticky top-0 z-10 flex flex-col gap-1.5 bg-zinc-950 pb-1">
        <SearchField value={q} onChange={setQ} placeholder="Search commits…" />
        <div className="flex items-center gap-2">
          {/* Filter by project on the RIGHT; dropdown opens bottom-right. */}
          <div ref={filterRef} className="relative ml-auto">
            <button
              onClick={() => setFilterOpen((o) => !o)}
              title="filter by project"
              aria-label="Filter by project"
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              className="flex max-w-full items-center rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <span className="truncate">{repo ?? "Filter"}</span>
            </button>
            {filterOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 flex max-h-72 w-48 flex-col overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setRepo(null);
                    setFilterOpen(false);
                  }}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
                >
                  <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                    All
                  </span>
                  {repo === null && (
                    <span className="ml-auto text-xs text-blue-400">✓</span>
                  )}
                </button>
                {repos.map((r) => (
                  <button
                    key={r}
                    role="menuitem"
                    onClick={() => {
                      setRepo((p) => (p === r ? null : r));
                      setFilterOpen(false);
                    }}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
                  >
                    <span className="min-w-0 truncate font-mono text-[11px] text-zinc-300">
                      {r}
                    </span>
                    {repo === r && (
                      <span className="ml-auto text-xs text-blue-400">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {shown.length > 0 ? (
        <ul className="flex flex-col">
          {shown.map((s) => (
            <li key={`${s.repo}:${s.sha}`}>
              <Link
                href={`/shipped?repo=${s.repo}&commit=${s.sha}${pinTail}`}
                scroll={false}
                className="flex w-full items-baseline gap-3 border-b border-zinc-800/60 py-3 text-left transition-colors hover:bg-zinc-800/30"
              >
                <span className="flex shrink-0 items-baseline gap-1.5">
                  <span
                    className="text-[10px] leading-none text-green-500"
                    aria-hidden
                  >
                    ●
                  </span>
                  <span className="font-mono text-xs text-zinc-200">
                    {s.sha}
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                  {s.subject}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                  {s.repo}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-600">
          {q || repo
            ? "no commits matching this filter"
            : "no git repos under ~/code"}
        </p>
      )}
    </div>
  );
}
