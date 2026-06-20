import Link from "next/link";
import DraggableCard from "@/app/ui/draggable-card";
import { ago } from "@/lib/ago";
import { queryTokens, scriptFilePath, type SearchHit } from "@/lib/search";

// Mark WHY a snippet matched. Prefer the contiguous phrase — the query tokens in
// order with any punctuation/whitespace between them — so "wow..you did it" lights
// up as one span. If the phrase isn't contiguous here (the AND-of-tokens fallback),
// mark each token. Tokens are normalized (lowercase, alphanumeric) so the joined
// pattern needs no escaping. (Lifted verbatim from the old inline list.)
function highlight(text: string, query: string): React.ReactNode {
  const toks = queryTokens(query);
  if (toks.length === 0) return text;

  let ranges: [number, number][] = [];
  const phraseRe = new RegExp(toks.join("[^a-z0-9]+"), "ig");
  for (let m = phraseRe.exec(text); m; m = phraseRe.exec(text)) {
    ranges.push([m.index, m.index + m[0].length]);
    if (m.index === phraseRe.lastIndex) phraseRe.lastIndex++; // guard zero-width
  }
  if (ranges.length === 0) {
    const lower = text.toLowerCase();
    for (const t of toks)
      for (let p = lower.indexOf(t); p !== -1; p = lower.indexOf(t, p + t.length))
        ranges.push([p, p + t.length]);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    ranges = merged;
  }

  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (const [s, e] of ranges) {
    if (s > i) out.push(text.slice(i, s));
    out.push(
      <mark key={k++} className="rounded-sm bg-blue-500/30 px-0.5 text-zinc-100">
        {text.slice(s, e)}
      </mark>
    );
    i = e;
  }
  out.push(text.slice(i));
  return out;
}

// The footer's left slot — the result's identity: a short session id, else the
// file path, else the bare ref.
function footRef(h: SearchHit): string {
  if (h.kind === "transcript" || h.kind === "session" || h.kind === "sdk")
    return h.ref.slice(0, 8);
  return h.path ?? h.ref;
}

// Route each kind to its in-panel reader (the page owns the matching open* branch;
// session/sdk reuse the transcript reader, project lists its sessions).
function openParam(h: SearchHit): string {
  switch (h.kind) {
    case "transcript":
    case "session":
    case "sdk":
      return `openSession=${h.ref}`;
    case "note":
      return `openNote=${encodeURIComponent(h.ref)}`;
    case "script":
      return `openScript=${encodeURIComponent(h.ref)}`;
    case "memory":
      return `open=${encodeURIComponent(h.ref)}`;
    case "file":
      return `openFile=${encodeURIComponent(h.ref)}`;
    case "component":
      return `openComponent=${encodeURIComponent(h.ref)}`;
    case "commit":
      return `openCommit=${encodeURIComponent(h.ref)}`;
    case "todo":
      return `openTodo=${encodeURIComponent(h.ref)}`;
    case "project":
      return `openProject=${encodeURIComponent(h.ref)}`;
    case "skill":
      return `openSkill=${encodeURIComponent(h.ref)}`;
    case "doc":
      return `openDoc=${encodeURIComponent(h.ref)}`;
  }
}

// One result row. Click opens the thing in its in-panel reader (the corpus header
// above carries the kind, so the card itself stays badge-free and quiet). Anything
// with a real path is draggable into a terminal (drops the path). `back` already
// carries q/scope/sort + the terminal pins, so every open is pin-safe.
export default function SearchResultCard({
  hit,
  q,
  back,
}: {
  hit: SearchHit;
  q: string;
  back: string;
}) {
  const href = `${back}&${openParam(hit)}`;
  const drag =
    hit.kind === "script"
      ? scriptFilePath(hit.ref)
      : hit.kind === "file" || hit.kind === "component"
        ? hit.path ?? null
        : null;
  const cardCls =
    "block rounded-md border border-zinc-800/80 px-3 py-2 transition-colors hover:border-zinc-600 hover:bg-zinc-900/50 focus-visible:border-zinc-500 focus-visible:bg-zinc-900/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600";
  const inner = (
    <>
      <div className="truncate text-sm font-medium text-zinc-200">{hit.title}</div>
      {hit.snippet && (
        <p className="mt-0.5 line-clamp-2 break-words text-xs text-zinc-400">
          {highlight(hit.snippet, q)}
        </p>
      )}
      <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-zinc-600">
        <span className="min-w-0 truncate">{footRef(hit)}</span>
        {hit.meta && <span className="shrink-0 text-zinc-500">{hit.meta}</span>}
        <span className="ml-auto shrink-0">{ago(hit.at)}</span>
      </div>
    </>
  );
  return drag ? (
    <DraggableCard href={href} drag={drag} className={cardCls}>
      {inner}
    </DraggableCard>
  ) : (
    <Link href={href} scroll={false} className={cardCls}>
      {inner}
    </Link>
  );
}
