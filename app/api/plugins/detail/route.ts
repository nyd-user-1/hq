import { getPluginDetail } from "@/lib/plugin-detail";

// Reads marketplace + install state + the plugin's own files off disk; never cache.
export const dynamic = "force-dynamic";

// GET ?ref=<plugin>@<marketplace> — full detail for one plugin (description,
// provenance, and what it ships), read on demand when its card is opened.
export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get("ref");
  if (!ref) return Response.json({ error: "a plugin ref is required" }, { status: 400 });
  return Response.json({ detail: getPluginDetail(ref) });
}
