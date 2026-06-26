import { getCommandsLibrary } from "@/lib/commands-library";

// Reads the CLI registry + ~/.claude/commands + enabled plugins' commands; never cache.
export const dynamic = "force-dynamic";

// GET — the unified commands library (built-in + yours + plugin-shipped).
export async function GET() {
  return Response.json({ commands: getCommandsLibrary() });
}
