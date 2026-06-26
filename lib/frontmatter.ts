// A small YAML-frontmatter parser for SKILL.md / command files. Beyond flat
// `key: value` pairs it handles **block scalars** — `description: >` (folded) or
// `description: |` (literal) with the text on the following indented lines, the
// style plugin skills (caveman, ponytail) use for their descriptions. A naive
// single-line parse captures just ">" there, which is why those cards rendered
// empty. Folded joins lines with spaces; literal keeps newlines.
export function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return out;
  const lines = block[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2];
    // Block scalar indicator: `>`, `|`, with optional chomp (`+`/`-`).
    if (/^[>|][+-]?$/.test(val.trim())) {
      const folded = val.trim()[0] === ">";
      const collected: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim() === "") {
          collected.push("");
          continue;
        }
        if (/^\s/.test(lines[j])) {
          collected.push(lines[j].trim());
          continue;
        }
        break; // a non-indented line ends the scalar (next key)
      }
      while (collected.length && collected[collected.length - 1] === "") collected.pop();
      out[key] = folded
        ? collected.join(" ").replace(/\s+/g, " ").trim()
        : collected.join("\n").trim();
      i = j - 1;
      continue;
    }
    out[key] = val.replace(/^["']|["']$/g, "").trim();
  }
  return out;
}
