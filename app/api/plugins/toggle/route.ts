import { setPluginEnabled } from "@/lib/plugin-install";
import { isEnabled } from "@/lib/plugin-catalog";

// Shells out to the claude CLI; never cache.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { ref, on } — the universal install/enable/disable for any catalog plugin.
// `enabled` reflects the AUTHORITATIVE re-read of enabledPlugins, not CLI stdout.
export async function POST(req: Request) {
  try {
    const { ref, on } = await req.json();
    if (typeof ref !== "string" || !ref.includes("@"))
      return Response.json({ error: "a plugin ref (name@marketplace) is required" }, { status: 400 });
    const r = setPluginEnabled(ref, !!on);
    const enabled = isEnabled(ref);
    return Response.json({
      ref,
      enabled,
      error: enabled === !!on ? undefined : r.error || "toggle did not take — see log",
      log: r.log,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "toggle failed" },
      { status: 500 },
    );
  }
}
