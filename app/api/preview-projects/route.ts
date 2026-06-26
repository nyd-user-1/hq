import { NextResponse } from "next/server";
import { previewProjects, setPreviewOverride } from "@/lib/preview-projects";

export const dynamic = "force-dynamic";

// GET → the universal project list (cwds ∪ projectsRoot) with inferred/overridden
// dev URLs + a liveness snapshot. POST { path, url } → persist a per-project URL
// override (blank url clears it).
export async function GET() {
  try {
    return NextResponse.json({ projects: await previewProjects() });
  } catch {
    return NextResponse.json({ projects: [] });
  }
}

export async function POST(req: Request) {
  try {
    const { path, url } = await req.json();
    if (typeof path !== "string" || !path) return NextResponse.json({ ok: false }, { status: 400 });
    setPreviewOverride(path, typeof url === "string" ? url : "");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
