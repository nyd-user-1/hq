import { getSettings } from "@/lib/settings-config";

// Reads ~/.claude/settings.json off disk — never cache.
export const dynamic = "force-dynamic";

// GET — the structured settings summary (grouped sections + masked raw JSON).
// Secret-looking values are masked AT THE SOURCE in the reader; nothing verbatim
// leaves the server.
export async function GET() {
  return Response.json(getSettings());
}
