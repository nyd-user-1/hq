import Link from "next/link";
import SearchResultCard from "@/app/ui/search-result-card";
import type { SearchHit } from "@/lib/search";
import type { Corpus } from "@/app/ui/search-corpus";

// One corpus section in the results column: an accent header (dot · label ·
// count) over its cards, hung off a quiet left rule so the grouping reads at a
// glance. `drillHref` (the "all →" link) appears only when the corpus was capped
// in the overview, and drills into that corpus at full depth.
export default function SearchResultGroup({
  corpus,
  hits,
  q,
  back,
  count,
  drillHref,
}: {
  corpus: Corpus;
  hits: SearchHit[];
  q: string;
  back: string;
  count: string;
  drillHref?: string;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${corpus.dot}`} aria-hidden />
        <h2 className={`font-mono text-[11px] uppercase tracking-wider ${corpus.text}`}>
          {corpus.label}
        </h2>
        {count && <span className="font-mono text-[10px] text-zinc-600">{count}</span>}
        {drillHref && (
          <Link
            href={drillHref}
            scroll={false}
            className="ml-auto shrink-0 font-mono text-[10px] text-zinc-500 transition-colors hover:text-zinc-300"
          >
            all →
          </Link>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 border-l border-zinc-800/60 pl-2.5">
        {hits.map((h) => (
          <SearchResultCard key={`${h.kind}:${h.ref}`} hit={h} q={q} back={back} />
        ))}
      </div>
    </section>
  );
}
