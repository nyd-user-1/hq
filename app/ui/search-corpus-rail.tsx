import Link from "next/link";
import { CORPORA } from "@/app/ui/search-corpus";
import type { SearchScope } from "@/lib/search";

// The Corpus Spectrum — the page's signature. An accent-coded index of every
// corpus HQ can search, doubling as the scope filter AND a jump-nav. In the "all"
// overview each row carries its live match count, so the rail reads as the SHAPE
// of your matches across everything HQ has seen — not just a filter, a readout.
// Responsive by CSS alone: a wrapping chip row on a narrow panel, a left column
// when there's room. Pure presentational — every row is a pin-carrying <Link>, so
// picking a scope re-renders the server page in place without dropping the
// terminal pins.
export default function SearchCorpusRail({
  active,
  counts,
  dimEmpty = false,
  q,
  sort,
  pins,
}: {
  active: SearchScope;
  counts: Record<string, string>; // scope -> display count; present only where there are hits
  dimEmpty?: boolean; // true while a query is active in overview → fade zero-hit corpora
  q: string;
  sort: string;
  pins: string;
}) {
  const tail = pins ? `&${pins}` : "";
  const href = (s: SearchScope) =>
    `/search?q=${encodeURIComponent(q)}&scope=${s}&sort=${sort}${tail}`;
  const rowCls = (on: boolean) =>
    `flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${
      on
        ? "bg-zinc-800/70 text-zinc-100"
        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
    }`;
  return (
    <nav
      aria-label="Filter by corpus"
      className="flex flex-row flex-wrap gap-1 sm:flex-col sm:flex-nowrap"
    >
      <Link href={href("all")} scroll={false} className={rowCls(active === "all")}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500" aria-hidden />
        <span className="font-mono text-[11px]">All</span>
      </Link>
      {CORPORA.map((c) => {
        const n = counts[c.scope] ?? "";
        const on = active === c.scope;
        const empty = dimEmpty && !n;
        return (
          <Link
            key={c.scope}
            href={href(c.scope)}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={`${rowCls(on)} ${empty ? "opacity-40" : ""}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.dot}`} aria-hidden />
            <span className="font-mono text-[11px]">{c.label}</span>
            {n && (
              <span className="ml-auto pl-1 font-mono text-[10px] text-zinc-600">{n}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
