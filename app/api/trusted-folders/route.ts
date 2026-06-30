import { getTrustedFolders } from "@/lib/trusted-folders";

// Reads ~/.claude.json off disk — never cache.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ folders: getTrustedFolders() });
}
