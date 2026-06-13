import Boundary from "@/app/ui/boundary";
import Link from "next/link";
import CopyText from "@/app/ui/copy-text";
import { getShipped, getCommit } from "@/lib/shipped";
import { ago } from "@/lib/ago";

export const dynamic = "force-dynamic";

// Color a `git show` line by its diff role.
function DiffLine({ line }: { line: string }) {
  let cls = "text-zinc-400";
  if (
    line.startsWith("commit ") ||
    line.startsWith("Author:") ||
    line.startsWith("Date:")
  )
    cls = "text-zinc-500";
  else if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  )
    cls = "text-zinc-600";
  else if (line.startsWith("@@")) cls = "text-cyan-400";
  else if (line.startsWith("+")) cls = "text-emerald-300";
  else if (line.startsWith("-")) cls = "text-red-300";
  return <div className={`whitespace-pre ${cls}`}>{line || " "}</div>;
}

// Shipped: cross-project commit feed. A row opens that commit's diff IN the
// panel (?repo=&commit=) — same as a memory/transcript opening here.
export default async function Shipped({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; commit?: string }>;
}) {
  const { repo, commit } = await searchParams;

  // ── opened commit ────────────────────────────────────────────────────────
  if (commit) {
    const c = getCommit(repo ?? "", commit);
    return (
      <Boundary topOnly label="@panel/shipped/page.tsx">
        <div className="flex items-baseline gap-3">
          <Link
            href="/shipped"
            scroll={false}
            className="shrink-0 font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← shipped
          </Link>
          {c ? (
            <CopyText
              text={c.sha}
              className="min-w-0 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300"
            >
              {c.repo} · {c.sha}
            </CopyText>
          ) : (
            <span className="font-mono text-xs text-zinc-600">
              commit not found
            </span>
          )}
        </div>
        <div className="scrollbar-none min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-relaxed">
          {c ? (
            c.text.split("\n").map((l, i) => <DiffLine key={i} line={l} />)
          ) : (
            <p className="text-xs text-zinc-600">could not load this commit</p>
          )}
        </div>
      </Boundary>
    );
  }

  // ── feed ─────────────────────────────────────────────────────────────────
  const ships = getShipped();
  return (
    <Boundary topOnly label="@panel/shipped/page.tsx">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Shipped</h3>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          {ships.length} commits · all projects
        </span>
      </div>
      {ships.length > 0 ? (
        <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {ships.map((s) => (
            <li key={`${s.repo}:${s.sha}`}>
              <Link
                href={`/shipped?repo=${s.repo}&commit=${s.sha}`}
                scroll={false}
                className="-mx-1 flex items-baseline gap-2 rounded px-1 py-1 text-sm transition-colors hover:bg-zinc-900/60"
              >
                <span className="shrink-0 font-mono text-[11px] text-blue-400">
                  {s.sha}
                </span>
                <span className="w-14 shrink-0 truncate font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                  {s.repo}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-300">
                  {s.subject}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                  {ago(s.at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-600">no git repos under ~/code</p>
      )}
      <p className="text-xs text-zinc-600">
        git log across every ~/code repo · newest first · click a commit to read
        its diff here
      </p>
    </Boundary>
  );
}
