import React from "react";
import CommitLink from "@/app/ui/commit-link";
import CopyCode from "@/app/ui/copy-code";

// An inline `code` token that looks like a commit hash → link it to its diff
// (the Shipped reader resolves which repo it's in). Everything else → copy chip.
const SHA = /^[0-9a-f]{7,40}$/i;

// Lightweight markdown for the terminal — no library. Handles the cases Claude's
// replies actually use: **bold**, *italic*, `code` (accent-colored, the "purple"
// the real CLI shows), [links](url), # headings, - / 1. lists, and GFM tables.
// (Nested lists are the only thing left that'd push us to react-markdown.)

// A GFM table separator row, e.g. `|---|:--:|` — all pipes/dashes/colons/space,
// with at least one dash and one pipe (so it can't be confused with prose).
const isSepRow = (s: string) => /^[\s|:-]+$/.test(s) && s.includes("-") && s.includes("|");
// Split a `| a | b |` row into trimmed cells (drop the outer pipes).
const parseRow = (s: string) =>
  s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
// Column alignment from a separator cell (`:--` left, `--:` right, `:-:` center).
const alignClass = (s: string) => {
  const t = s.trim();
  const l = t.startsWith(":");
  const r = t.endsWith(":");
  return l && r ? "text-center" : r ? "text-right" : "text-left";
};

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
        className="whitespace-pre-wrap break-words rounded-md bg-zinc-900/60 p-2.5 font-mono text-[12px] leading-relaxed text-zinc-300"
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

  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
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

    // GFM table: a `|`-cell row whose NEXT line is a |---|---| separator. Consume
    // the header, the separator (for alignment), and every following pipe row.
    if (line.includes("|") && li + 1 < lines.length && isSepRow(lines[li + 1])) {
      flush();
      const header = parseRow(line);
      const aligns = parseRow(lines[li + 1]).map(alignClass);
      const rows: string[][] = [];
      let j = li + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
        rows.push(parseRow(lines[j]));
        j++;
      }
      blocks.push(
        <table key={key++} className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {header.map((c, ci) => (
                <th
                  key={ci}
                  className={`border border-zinc-800 bg-zinc-900/40 px-2 py-1 font-semibold text-zinc-200 ${aligns[ci] ?? "text-left"}`}
                >
                  {inline(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td
                    key={ci}
                    className={`border border-zinc-800 px-2 py-1 align-top text-zinc-300 ${aligns[ci] ?? "text-left"}`}
                  >
                    {inline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      li = j - 1; // resume after the consumed table rows
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
