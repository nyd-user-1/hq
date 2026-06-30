import { teams } from "@/lib/teams";
import { leadTranscriptFor } from "@/lib/team-tmux";

// Reads ~/.claude/teams/*/config.json off disk; never cache.
export const dynamic = "force-dynamic";

// GET — every agent team on disk (or [] when the experimental feature has never
// been enabled). The client renders the roster + drills into a member's
// transcript via the lead session. `leadTranscriptId` is the lead's REAL
// transcript (== leadSessionId for in-process teams; the hq-spawned --session-id
// uuid for tmux teams, whose config.leadSessionId is a transcript-less team id) —
// the id T1 must pin to so the lead actually resolves and is drivable.
export async function GET() {
  return Response.json({
    teams: teams().map((t) => ({ ...t, leadTranscriptId: leadTranscriptFor(t) })),
  });
}
