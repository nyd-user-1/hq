import { PLUGINS, viewOf } from "@/lib/plugins";
import { installPlugin } from "@/lib/plugin-install";

// Shells out to the claude CLI; never cache.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { id } — one-click install a /plugin plugin via `claude plugin marketplace
// add` + `claude plugin install … --scope user`. `ok` reflects the AUTHORITATIVE
// re-detect (enabledPlugins), not CLI stdout; `log` is for debugging on failure.
export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    const def = PLUGINS.find((p) => p.id === id);
    if (!def) return Response.json({ error: `unknown plugin: ${id}` }, { status: 400 });
    if (!def.pluginInstall)
      return Response.json({ error: `${id} has no one-click install` }, { status: 400 });

    const r = installPlugin(def.pluginInstall);
    const plugin = viewOf(def); // re-detect via enabledPlugins
    return Response.json({
      ok: plugin.installed,
      error: plugin.installed ? undefined : r.error || "install did not register — see log",
      log: r.log,
      plugin,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "install failed" },
      { status: 500 },
    );
  }
}
