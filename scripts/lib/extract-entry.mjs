// The ONE definition of "what text does a transcript jsonl entry contribute to
// the search index". Shared by BOTH index paths so they can never drift:
//   • scripts/build-search-index.mjs (the out-of-process FTS5 builder)
//   • lib/archive.ts (the live-scan of sessions newer than the snapshot)
// If these two extract different text, a freshly-typed session and the same
// session post-rebuild would return different hits — the exact bug this prevents.
//
// Pure strings, zero node deps, so it bundles into the TS lib AND runs under plain
// `node` in the build script.

// Strip system-reminders (else every session matches common project terms from
// the injected memory index) + tags, collapse whitespace. Mirrors
// lib/sessions.cleanText.
export function cleanText(t) {
  return t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The small, high-value string fields of a tool_use INPUT — paths, commands,
// patterns, urls — so a filename mentioned only in a Read/Edit/Write/Bash call is
// findable by that name. Deliberately NOT the whole input blob, and (in the caller)
// NOT tool_result bodies: full file reads + command output is the bloat that killed
// the old 16MB JSON index.
const TOOL_INPUT_FIELDS = [
  "file_path",
  "path",
  "notebook_path",
  "command",
  "pattern",
  "glob",
  "url",
  "old_path",
  "new_path",
];
function toolInputText(input) {
  if (!input || typeof input !== "object") return "";
  const parts = [];
  for (const f of TOOL_INPUT_FIELDS) {
    const v = input[f];
    if (typeof v === "string" && v) parts.push(v);
  }
  return parts.join(" ");
}

// The searchable text contributed by ONE parsed jsonl entry: assistant/user
// message TEXT blocks, PLUS tool_use input paths/commands. Non-user/assistant
// entries (and tool_result content) contribute nothing.
export function extractEntryText(e) {
  if (!e || (e.type !== "user" && e.type !== "assistant")) return "";
  const c = e.message?.content;
  if (typeof c === "string") return cleanText(c) + "\n";
  if (!Array.isArray(c)) return "";
  let out = "";
  for (const b of c) {
    if (b?.type === "text" && b.text) out += cleanText(b.text) + "\n";
    else if (b?.type === "tool_use") {
      const t = toolInputText(b.input);
      if (t) out += cleanText(t) + "\n";
    }
  }
  return out;
}
