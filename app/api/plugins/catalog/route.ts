import { getCatalog } from "@/lib/plugin-catalog";

// Reads marketplace manifests + enabledPlugins off disk; never cache.
export const dynamic = "force-dynamic";

// GET — the full Claude Code plugin catalog (every registered marketplace) with
// each plugin's enabled state. The client searches/filters it.
export async function GET() {
  return Response.json({ plugins: getCatalog() });
}
