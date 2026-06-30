import { getAudit, readAuditDoc } from "@/lib/audit";

// Reads instruction/memory files on disk — never cache.
export const dynamic = "force-dynamic";

// GET — the audit list (every-session tax + per-project rules + memory store),
// OR a single .md's content when ?open=<path> is set (the in-panel reader drill-
// down; reuses the route page's getAudit/readAuditDoc, path-guarded in the lib).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const open = u.searchParams.get("open");
  if (open) {
    return Response.json({ content: readAuditDoc(open) });
  }
  return Response.json(getAudit());
}
