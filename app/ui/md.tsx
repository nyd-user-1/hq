import React from "react";
import CommitLink from "@/app/ui/commit-link";
import CopyCode from "@/app/ui/copy-code";

// An inline `code` token that looks like a commit hash → link it to its diff
// (the Shipped reader resolves which repo it's in). Everything else → copy chip.
const SHA = /^[0-9a-f]{7,40}$/i;

// Lightweight markdown for the terminal — no library. Handles the cases Claude's
// replies actually use: **bold**, *italic*, `code` (accent-colored, the "purple"
// the real CLI shows), [links](url), # headings, and - / 1. lists. Full GFM
// (tables, nested lists) would be the reason to reach for react-markdown later.

const INLINE =
  /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined)
      out.push(
        <strong key={i} className="font-semibold text-zinc-100">
          {m[2]}
        </strong>
      );
    else if (m[4] !== undefined)
      out.push(
        SHA.test(m[4]) ? (
          <CommitLink key={i} sha={m[4]} />
        ) : (
          <CopyCode key={i}>{m[4]}</CopyCode>
        )
      );
    else if (m[6] !== undefined)
      out.push(
        <em key={i} className="italic text-zinc-400">
          {m[6]}
        </em>
      );
    else if (m[8] !== undefined)
      out.push(
        <a key={i} href={m[9]} className="text-blue-400 underline">
          {m[8]}
        </a>
      );
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = []; // consecutive prose lines → ONE reflowing paragraph
  let code: string[] | null = null; // inside a ``` fence (lines kept verbatim)
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items;
    blocks.push(
      list.ordered ? (
        <ol key={key++} className="ml-5 list-decimal space-y-0.5">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key++} className="ml-5 list-disc space-y-0.5">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>
      )
    );
    list = null;
  };

  // A blank line / heading / list / fence ENDS a paragraph; the prose lines that
  // accumulated are joined with spaces and rendered as one <p> so the paragraph
  // REFLOWS to fill the container width (markdown's soft-wrap rule), instead of
  // one stranded short <p> per hard-wrapped source line.
  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(<p key={key++}>{inline(para.join(" "))}</p>);
    para = [];
  };

  const flushCode = () => {
    if (code === null) return;
    blocks.push(
      <pre
        key={key++}
        className="overflow-x-auto whitespace-pre rounded-md bg-zinc-900/60 p-2.5 font-mono text-[12px] leading-relaxed text-zinc-300"
      >
        {code.join("\n")}
      </pre>
    );
    code = null;
  };

  const flush = () => {
    flushList();
    flushPara();
  };

  for (const line of text.split("\n")) {
    // Fenced code: ``` toggles a verbatim block — its lines are NEVER joined.
    if (line.trim().startsWith("```")) {
      if (code === null) {
        flush();
        code = [];
      } else {
        flushCode();
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (h) {
      flush();
      blocks.push(
        <p key={key++} className="font-semibold text-zinc-100">
          {inline(h[2])}
        </p>
      );
    } else if (ul) {
      flushPara();
      if (list?.ordered) flushList();
      if (!list) list = { ordered: false, items: [] };
      list.items.push(ul[1]);
    } else if (ol) {
      flushPara();
      if (list && !list.ordered) flushList();
      if (!list) list = { ordered: true, items: [] };
      list.items.push(ol[1]);
    } else if (line.trim() === "") {
      flush();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushCode();
  flush();

  // break-words (overflow-wrap, inherited) so long unbreakable tokens — UUIDs,
  // paths, flags — wrap; joined paragraphs reflow to fill the available width.
  return <div className="space-y-2 break-words">{blocks}</div>;
}
