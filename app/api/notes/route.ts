import { NextResponse } from "next/server";
import { saveNote, getNotes } from "@/lib/notes";

export const dynamic = "force-dynamic";

// Note blocks saved from a terminal message block — POST to save one, GET to
// list. Storage is ~/.claude/hq/notes/*.md (lib/notes); Search reads the same
// dir so they're findable later.
export async function GET() {
  return NextResponse.json({ notes: getNotes() });
}

export async function POST(req: Request) {
  const { text, role, project, sessionId, at } = await req
    .json()
    .catch(() => ({}));
  if (typeof text !== "string" || !text.trim()) {
    return new NextResponse("text required", { status: 400 });
  }
  const name = saveNote({ text, role, project, sessionId, at });
  return NextResponse.json({ ok: true, name });
}
