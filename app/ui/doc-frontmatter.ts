// Client-safe frontmatter splitting for the Docs editor. The editor round-trips
// the BODY through ProseMirror and keeps the frontmatter block byte-for-byte
// (it's provenance metadata, not prose) — only the `title:` line is editable,
// through the doc's title field.

export type FmSplit = { fm: string | null; body: string };

// Split "---\n…\n---\n\nbody" → the fence block (verbatim, fences included) +
// the body. No frontmatter → fm: null, body: whole content.
export function splitFrontmatter(content: string): FmSplit {
  const m = content.match(/^(---\n[\s\S]*?\n---)\s*\n?/);
  if (!m) return { fm: null, body: content };
  return { fm: m[1], body: content.slice(m[0].length) };
}

export function joinFrontmatter(fm: string | null, body: string): string {
  if (!fm) return body;
  return `${fm}\n\n${body.replace(/^\n+/, "")}`;
}

export function fmTitle(fm: string | null): string | null {
  if (!fm) return null;
  return fm.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

// Replace (or insert) the title line, keeping every other frontmatter line
// untouched. Newlines are stripped from the value so it can't break the block.
export function withFmTitle(fm: string | null, title: string): string {
  const t = title.replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  if (!fm) return `---\ntitle: ${t}\n---`;
  if (/^title:/m.test(fm)) return fm.replace(/^title:.*$/m, `title: ${t}`);
  return fm.replace(/^---\n/, `---\ntitle: ${t}\n`);
}
