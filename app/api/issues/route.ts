import { getIssues, createIssue } from "@/lib/issues";

// Reads `gh` on demand — never cache.
export const dynamic = "force-dynamic";

// GET — the hq repo's GitHub Issues feed.
export async function GET() {
  return Response.json({ issues: getIssues() });
}

// POST — file a new issue from the in-panel composer ({title, body}).
export async function POST(req: Request) {
  let payload: { title?: string; body?: string };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const result = createIssue(payload.title ?? "", payload.body ?? "");
  return Response.json(result);
}
