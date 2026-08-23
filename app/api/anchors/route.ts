import { NextResponse } from "next/server";
import { addAnchors, getAnchors, removeAnchor, type Anchor } from "@/lib/anchors";

export const dynamic = "force-dynamic";

// Anchored questions — a per-session sidecar at ~/.claude/hq/anchors.json (see
// lib/anchors.ts). GET ?session= hydrates; POST appends the anchors the terminal
// minted on a send; DELETE removes one.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const session = searchParams.get("session") ?? "";
  if (!session) return NextResponse.json({ anchors: [] });
  return NextResponse.json({ anchors: getAnchors(session) });
}

const isQuote = (q: unknown): q is Anchor["quote"] =>
  !!q && typeof q === "object" &&
  typeof (q as Anchor["quote"]).exact === "string" &&
  typeof (q as Anchor["quote"]).prefix === "string" &&
  typeof (q as Anchor["quote"]).suffix === "string";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId, anchors } = body ?? {};
  if (typeof sessionId !== "string" || !sessionId || !Array.isArray(anchors))
    return new NextResponse("sessionId and anchors[] required", { status: 400 });
  const clean: Anchor[] = [];
  for (const a of anchors) {
    if (!a || typeof a.id !== "string" || !isQuote(a.quote) || typeof a.sent !== "string") continue;
    clean.push({
      id: a.id,
      createdAt: typeof a.createdAt === "string" ? a.createdAt : new Date().toISOString(),
      quote: { exact: a.quote.exact.slice(0, 4000), prefix: a.quote.prefix.slice(0, 200), suffix: a.quote.suffix.slice(0, 200) },
      sourceTurn: typeof a.sourceTurn === "string" ? a.sourceTurn : undefined,
      question: typeof a.question === "string" ? a.question.slice(0, 4000) : "",
      sent: a.sent.slice(0, 20000),
    });
  }
  return NextResponse.json({ anchors: addAnchors(sessionId, clean) });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const session = searchParams.get("session") ?? "";
  const id = searchParams.get("id") ?? "";
  if (!session || !id) return new NextResponse("session and id required", { status: 400 });
  return NextResponse.json({ anchors: removeAnchor(session, id) });
}
