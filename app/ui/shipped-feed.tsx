"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import SearchField from "@/app/ui/search-field";
import type { Ship } from "@/lib/shipped";

// The commit feed, client-side so the search box filters live (mirrors the
// Components panel header: a sticky SearchField + a caption). Each row IS the
// Skills row — green dot (a landed commit) · sha · subject · repo. A row opens
// that commit's diff in-panel; the href carries the terminal pins (pinTail).
export default function ShippedFeed({
  ships,
  pinTail,
}: {
  ships: Ship[];
  pinTail: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ships;
    return ships.filter(
      (s) =>
        s.sha.toLowerCase().includes(needle) ||
        s.subject.toLowerCase().includes(needle) ||
        s.repo.toLowerCase().includes(needle)
    );
  }, [ships, q]);

  return (
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="sticky top-0 z-10 flex flex-col gap-1.5 bg-zinc-950 pb-1">
        <SearchField value={q} onChange={setQ} placeholder="Search commits…" />
        <p className="text-[11px] text-zinc-500">
          *Click a commit to read its diff here.
        </p>
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
          {q ? `no commits matching “${q}”` : "no git repos under ~/code"}
        </p>
      )}
    </div>
  );
}
