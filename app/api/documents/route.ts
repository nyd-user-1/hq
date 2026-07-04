import { NextResponse } from "next/server";
import {
  listDocuments,
  createDocument,
  deleteDocument,
} from "@/lib/documents";

export const dynamic = "force-dynamic";

// The Docs surface's store API — list / create / delete documents under
// ~/.claude/hq/documents. Reads + writes of a document's CONTENT go through
// /api/file-edit (kind "document"), the same path every editable file takes.
// Same-origin middleware guards this like every route.

export async function GET() {
  return NextResponse.json({ documents: listDocuments() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { title, text, sessionId, source } = body ?? {};
  if (
    (title != null && typeof title !== "string") ||
    (text != null && typeof text !== "string") ||
    (sessionId != null && typeof sessionId !== "string") ||
    (source != null && typeof source !== "string")
  ) {
    return new NextResponse("bad request", { status: 400 });
  }
  const name = createDocument({ title, text, sessionId, source });
  return NextResponse.json({ name });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name") ?? "";
  if (!name) return new NextResponse("bad request", { status: 400 });
  const ok = deleteDocument(name);
  if (!ok) return new NextResponse("not found", { status: 404 });
  return NextResponse.json({ ok: true });
}
