import { NextResponse } from "next/server";
import path from "node:path";
import { getNotes } from "@/lib/notes";
import { getAudit } from "@/lib/audit";
import { getTodos } from "@/lib/todo";
import { getRecentSessions } from "@/lib/sessions";
import { getShipped } from "@/lib/shipped";

export const dynamic = "force-dynamic";

// The single source of truth for what HQ publishes to system Spotlight. The
// native shell (hq-shell.swift) GETs this and pushes each item into CoreSpotlight,
// so adding a content type is a change HERE ONLY — no native code. Each item
// carries its own open path through the /go contract.
type Item = { type: string; title: string; snippet: string; path: string };

const go = (type: string, ref: string) =>
  `/go?type=${type}&ref=${encodeURIComponent(ref)}`;

// Standardized subtitle, mirroring how Apple Notes shows "— Notes · iCloud".
// macOS does NOT auto-label our CoreSpotlight items, so we bake it into the title.
const LABEL: Record<string, string> = {
  note: "Note", memory: "Memory", todo: "Todo", transcript: "Transcript", commit: "Commit",
};
const item = (type: string, title: string, snippet: string, ref: string): Item => ({
  type,
  title: `${title} — ${LABEL[type]} · hq`,
  snippet,
  path: go(type, ref),
});

export function GET() {
  const items: Item[] = [];

  // priority order: memory, todo, transcript, commit (+ notes, already live)
  for (const m of getAudit().memory)
    items.push(item("memory", m.description || m.name, m.name, path.basename(m.path)));

  for (const t of getTodos().filter((t) => !t.done))
    items.push(item("todo", t.text, t.body ?? "", t.id));

  for (const s of getRecentSessions(60))
    items.push(item("transcript", s.customTitle || s.title || s.project || s.id, s.project, s.id));

  for (const c of getShipped(80, 20))
    items.push(item("commit", c.subject, `${c.repo} · ${c.body}`.slice(0, 300), `${c.repo}/${c.sha}`));

  for (const n of getNotes())
    items.push(item("note", n.title, "", n.name));

  return NextResponse.json({ count: items.length, items });
}
