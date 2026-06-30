import { teams } from "@/lib/teams";

// Reads ~/.claude/teams/*/config.json off disk; never cache.
export const dynamic = "force-dynamic";

// GET — every agent team on disk (or [] when the experimental feature has never
// been enabled). The client renders the roster + drills into a member's
// transcript via the lead session.
export async function GET() {
  return Response.json({ teams: teams() });
}
