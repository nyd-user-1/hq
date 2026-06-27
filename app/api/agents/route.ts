import { getAgentsLibrary } from "@/lib/agents";

// Reads ~/.claude/agents + enabled plugins' agents off disk; never cache.
export const dynamic = "force-dynamic";

// GET — the unified agents library (yours + plugin-shipped + built-ins), each
// tagged with its source. The client searches/filters it.
export async function GET() {
  return Response.json({ agents: getAgentsLibrary() });
}
