import { NextResponse } from "next/server";
import { getSessionsMeta, setSessionMeta } from "@/lib/sessions-meta";

export const dynamic = "force-dynamic";

// HQ-native per-session view metadata (favorite / hidden / rename). A sidecar at
// ~/.claude/hq/sessions-meta.json — NOT a write into Claude Code's transcripts.
// The sidebar Recents list POSTs here to star / hide / rename a session.
export async function GET() {
  return NextResponse.json({ meta: getSessionsMeta() });
}

export async function POST(req: Request) {
  const { id, favorite, hidden, archived, title, project, related } = await req
    .json()
    .catch(() => ({}));
  if (typeof id !== "string" || !id) {
    return new NextResponse("id required", { status: 400 });
  }
  const patch: {
    favorite?: boolean;
    hidden?: boolean;
    archived?: boolean;
    title?: string;
    project?: string;
    related?: string[];
  } = {};
  if (typeof favorite === "boolean") patch.favorite = favorite;
  if (typeof hidden === "boolean") patch.hidden = hidden;
  if (typeof archived === "boolean") patch.archived = archived;
  if (typeof title === "string") patch.title = title;
  if (typeof project === "string") patch.project = project;
  if (Array.isArray(related)) patch.related = related;
  return NextResponse.json({ meta: setSessionMeta(id, patch) });
}
