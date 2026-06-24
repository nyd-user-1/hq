import { NextResponse } from "next/server";
import { getFilesMeta, setFileMeta, fileKey } from "@/lib/files-meta";

export const dynamic = "force-dynamic";

// GET  → all per-file view meta ({ files: { "kind:ref": { favorite, title } } }).
// POST → patch one item's favorite / custom title. Body: { kind, ref, favorite?, title? }.
export async function GET() {
  return NextResponse.json({ files: getFilesMeta() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  const ref = body?.ref;
  if (typeof kind !== "string" || typeof ref !== "string") {
    return new NextResponse("kind + ref required", { status: 400 });
  }
  const patch: { favorite?: boolean; title?: string } = {};
  if (typeof body.favorite === "boolean") patch.favorite = body.favorite;
  if (typeof body.title === "string") patch.title = body.title;
  const meta = setFileMeta(fileKey(kind, ref), patch);
  return NextResponse.json({ ok: true, meta });
}
