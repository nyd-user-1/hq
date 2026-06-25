import { getPluginViews, setPluginMode } from "@/lib/plugins";

// Reads/writes plugin config on disk — never cache.
export const dynamic = "force-dynamic";

// GET — the plugin library + each plugin's live status (installed? effective
// default mode? env-shadowed?).
export async function GET() {
  return Response.json({ plugins: getPluginViews() });
}

// POST { id, mode } — set a plugin's default mode by writing its config JSON.
// Returns the fresh, read-back view.
export async function POST(req: Request) {
  try {
    const { id, mode } = await req.json();
    if (typeof id !== "string" || typeof mode !== "string") {
      return Response.json({ error: "id and mode are required" }, { status: 400 });
    }
    const plugin = setPluginMode(id, mode);
    return Response.json({ plugin });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "bad request" },
      { status: 400 },
    );
  }
}
