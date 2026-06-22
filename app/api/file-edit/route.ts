import { NextResponse } from "next/server";
import { getMemoryFile, writeMemoryFile } from "@/lib/search";
import { getNoteFile, writeNoteFile } from "@/lib/notes";
import { getRepoFile, writeRepoFile } from "@/lib/files";

export const dynamic = "force-dynamic";

// Read/write the RAW content of an editable file behind the ⌘K reader's Edit
// pencil. Editable kinds only: memory notes, HQ notes, and repo .md files. GET
// returns the raw file (frontmatter included — the editor edits it verbatim); POST
// writes it back atomically. Same-origin middleware guards this like every route.

type Kind = "memory" | "note" | "file";
const READERS: Record<Kind, (ref: string) => string | null> = {
  memory: getMemoryFile,
  note: getNoteFile,
  file: getRepoFile,
};
const WRITERS: Record<Kind, (ref: string, content: string) => boolean> = {
  memory: writeMemoryFile,
  note: writeNoteFile,
  file: writeRepoFile,
};
const isKind = (k: string): k is Kind =>
  k === "memory" || k === "note" || k === "file";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") ?? "";
  const ref = searchParams.get("ref") ?? "";
  if (!isKind(kind) || !ref) return new NextResponse("bad request", { status: 400 });
  const content = READERS[kind](ref);
  if (content == null) return new NextResponse("not found", { status: 404 });
  return NextResponse.json({ content });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { kind, ref, content } = body;
  if (
    !isKind(kind) ||
    typeof ref !== "string" ||
    !ref ||
    typeof content !== "string"
  ) {
    return new NextResponse("bad request", { status: 400 });
  }
  const ok = WRITERS[kind](ref, content);
  if (!ok) {
    return new NextResponse("write failed (unknown or unwritable file)", { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
