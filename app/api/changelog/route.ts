import { getChangelog } from "@/lib/changelog";
import { getCommit, findCommit } from "@/lib/shipped";

// Reads git on disk — never cache.
export const dynamic = "force-dynamic";

// GET — the changelog feed, OR a single commit's diff when ?commit= is set (the
// in-panel diff drill-down; reuses Shipped's getCommit/findCommit).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const commit = u.searchParams.get("commit");
  if (commit) {
    const repo = u.searchParams.get("repo") ?? undefined;
    const diff = repo ? getCommit(repo, commit) : findCommit(commit);
    return Response.json({ diff });
  }
  return Response.json({ items: getChangelog() });
}
