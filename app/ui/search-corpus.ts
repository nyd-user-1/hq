import type { SearchScope, SearchKind } from "@/lib/search";

// The corpus spectrum — one row per searchable corpus, in the order the /search
// overview stacks them. Docs lead deliberately: they're HQ's offline
// best-practice oracle (the brief makes the docs corpus first-class). Each corpus
// carries its accent in three forms so the rail dot, the group header, and the
// result badge all read from ONE source. Type-only lib import → nothing from
// node:fs is bundled, so this file is safe in client components too.
export type Corpus = {
  scope: Exclude<SearchScope, "all">;
  kind: SearchKind;
  label: string;
  dot: string; // solid swatch — the rail marker
  text: string; // accent text — the group header
  chip: string; // bg+text — a result/badge pill (mirrors lib search-tags KIND_TAG)
};

// Accents mirror app/ui/search-tags.ts KIND_TAG so the whole search surface reads
// as one palette; `dot`/`text` are derived from the same hue. Sessions and
// transcripts intentionally share emerald (a session IS its transcript); the
// label disambiguates them on the rail.
export const CORPORA: Corpus[] = [
  { scope: "docs", kind: "doc", label: "Docs", dot: "bg-indigo-400", text: "text-indigo-300", chip: "bg-indigo-500/15 text-indigo-300" },
  { scope: "sessions", kind: "session", label: "Sessions", dot: "bg-emerald-400", text: "text-emerald-300", chip: "bg-emerald-500/15 text-emerald-300" },
  { scope: "transcripts", kind: "transcript", label: "Transcripts", dot: "bg-emerald-400", text: "text-emerald-300", chip: "bg-emerald-500/15 text-emerald-300" },
  { scope: "files", kind: "file", label: "Files", dot: "bg-sky-400", text: "text-sky-300", chip: "bg-sky-500/15 text-sky-300" },
  { scope: "commits", kind: "commit", label: "Commits", dot: "bg-orange-400", text: "text-orange-300", chip: "bg-orange-500/15 text-orange-300" },
  { scope: "components", kind: "component", label: "Components", dot: "bg-cyan-400", text: "text-cyan-300", chip: "bg-cyan-500/15 text-cyan-300" },
  { scope: "todos", kind: "todo", label: "Todos", dot: "bg-yellow-400", text: "text-yellow-300", chip: "bg-yellow-500/15 text-yellow-300" },
  { scope: "memory", kind: "memory", label: "Memory", dot: "bg-violet-400", text: "text-violet-300", chip: "bg-violet-500/15 text-violet-300" },
  { scope: "notes", kind: "note", label: "Notes", dot: "bg-blue-400", text: "text-blue-300", chip: "bg-blue-500/15 text-blue-300" },
  { scope: "projects", kind: "project", label: "Projects", dot: "bg-fuchsia-400", text: "text-fuchsia-300", chip: "bg-fuchsia-500/15 text-fuchsia-300" },
  { scope: "scripts", kind: "script", label: "Scripts", dot: "bg-amber-400", text: "text-amber-300", chip: "bg-amber-500/15 text-amber-300" },
  { scope: "skills", kind: "skill", label: "Skills", dot: "bg-rose-400", text: "text-rose-300", chip: "bg-rose-500/15 text-rose-300" },
  { scope: "sdk", kind: "sdk", label: "SDK", dot: "bg-teal-400", text: "text-teal-300", chip: "bg-teal-500/15 text-teal-300" },
];

export const CORPUS_BY_KIND = Object.fromEntries(
  CORPORA.map((c) => [c.kind, c])
) as Record<SearchKind, Corpus>;

// The signature spectrum, left→right in CORPORA order — the literal set of
// corpora a search spans. Used as the hairline under the input. Hex (not Tailwind)
// so the full 13-stop gradient survives JIT purging.
export const SPECTRUM_STOPS = [
  "#818cf8", "#34d399", "#34d399", "#38bdf8", "#fb923c", "#22d3ee", "#facc15",
  "#a78bfa", "#60a5fa", "#e879f9", "#fbbf24", "#fb7185", "#2dd4bf",
];
