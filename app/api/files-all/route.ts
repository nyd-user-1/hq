import { NextResponse } from "next/server";
import { filesIndex } from "@/lib/files-index";

export const dynamic = "force-dynamic";

// The ALL view's Finder table — every file-backed item with fs.stat metadata.
export async function GET() {
  return NextResponse.json({ rows: filesIndex() });
}
