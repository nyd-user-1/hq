import Boundary from "@/app/ui/boundary";
import Link from "next/link";
import CopyText from "@/app/ui/copy-text";
import BackLink from "@/app/ui/back-link";
import { getShipped, getCommit, findCommit } from "@/lib/shipped";
import { ago } from "@/lib/ago";

export const dynamic = "force-dynamic";

// Copy glyph (HQ has no icon lib): the standard two-rectangle clipboard mark.
// Inherits currentColor, so CopyText's emerald flash applies on copy.
function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

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
  // red reads fainter than green at the same opacity on a dark bg, so removed
  // lines get a touch more tint to match the added ones' weight.
  else if (line.startsWith("+")) cls = "bg-emerald-500/15 text-emerald-300";
  else if (line.startsWith("-")) cls = "bg-red-500/20 text-red-300";
  // hanging indent: the +/- marker sits in the gutter, wrapped continuations
  // indent past it so a wrap never reads as a new line.
  return (
    <div
      className={`whitespace-pre-wrap break-words pl-[2ch] pr-1 [text-indent:-2ch] ${cls}`}
    >
      {line || " "}
    </div>
  );
}

// Shipped: cross-project commit feed. A row opens that commit's diff IN the
// panel (?repo=&commit=) — same as a memory/transcript opening here.
export default async function Shipped({
  searchParams,
}: {
  searchParams: Promise<{
    repo?: string;
    commit?: string;
    session?: string;
    pair?: string;
  }>;
}) {
  const { repo, commit, session, pair } = await searchParams;
  // Carry the terminal pins on in-panel nav — without them the terminal goes
  // unpinned, re-pins via router.replace, and wipes ?commit (the card "snaps
  // back to the list" bug).
  const pins = [session && `session=${session}`, pair && `pair=${pair}`]
    .filter(Boolean)
    .join("&");
  const pinTail = pins ? `&${pins}` : "";

  // ── opened commit ────────────────────────────────────────────────────────
  if (commit) {
    // From the feed we know the repo; from a chat-window sha link we don't —
    // then search every repo for it.
    const c = repo ? getCommit(repo, commit) : findCommit(commit);
    return (
      <Boundary topOnly bleedX label="@panel/shipped/page.tsx">
        <div className="flex items-center gap-3">
          <BackLink
            href={`/shipped${pins ? `?${pins}` : ""}`}
            className="shrink-0 cursor-pointer font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← shipped
          </BackLink>
          {c ? (
            <>
              <CopyText
                text={c.sha}
                className="min-w-0 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300"
              >
                {c.repo} · {c.sha}
              </CopyText>
              <CopyText
                text={c.text}
                title="Copy full commit diff"
                className="ml-auto shrink-0 text-zinc-500 hover:text-zinc-300"
              >
                <CopyIcon />
              </CopyText>
            </>
          ) : (
            <span className="font-mono text-xs text-zinc-600">
              commit not found
            </span>
          )}
        </div>
        <div className="scrollbar-none min-h-0 flex-1 overflow-auto border-t border-zinc-800 pt-3 font-mono text-[11px] leading-relaxed">
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
    <Boundary topOnly bleedX label="@panel/shipped/page.tsx">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Shipped</h3>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          {ships.length} commits · all projects
        </span>
      </div>
      {ships.length > 0 ? (
        <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {ships.map((s) => (
            <li key={`${s.repo}:${s.sha}`}>
              <Link
                href={`/shipped?repo=${s.repo}&commit=${s.sha}${pinTail}`}
                scroll={false}
                className="flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2 transition-colors hover:border-zinc-600 hover:bg-zinc-900/50"
              >
                <div className="flex items-center gap-2.5">
                  <span className="shrink-0 font-mono text-sm text-blue-400">
                    {s.sha}
                  </span>
                  <span className="min-w-0 max-w-[140px] truncate font-mono text-xs text-zinc-500">
                    {s.repo}
                  </span>
                  <span className="ml-auto shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-blue-300">
                    commit
                  </span>
                </div>
                <p className="line-clamp-3 text-xs text-zinc-400">
                  {s.subject}
                  {s.body ? ` — ${s.body}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-600">no git repos under ~/code</p>
      )}
      <p className="text-xs text-zinc-600">
        every ~/code repo · newest first (each repo&apos;s latest always shown) ·
        click a commit to read its diff here
      </p>
    </Boundary>
  );
}
