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

export function GET() {
  const items: Item[] = [];

  // priority order: memory, todo, transcript, commit (+ notes, already live)
  for (const m of getAudit().memory)
    items.push({ type: "memory", title: m.description || m.name, snippet: m.name, path: go("memory", path.basename(m.path)) });

  for (const t of getTodos().filter((t) => !t.done))
    items.push({ type: "todo", title: t.text, snippet: t.body ?? "", path: go("todo", t.id) });

  for (const s of getRecentSessions(60))
    items.push({ type: "transcript", title: s.customTitle || s.title || s.project || s.id, snippet: s.project, path: go("transcript", s.id) });

  for (const c of getShipped(80, 20))
    items.push({ type: "commit", title: c.subject, snippet: `${c.repo} · ${c.body}`.slice(0, 300), path: go("commit", `${c.repo}/${c.sha}`) });

  for (const n of getNotes())
    items.push({ type: "note", title: n.title, snippet: "", path: go("note", n.name) });

  return NextResponse.json({ count: items.length, items });
}
