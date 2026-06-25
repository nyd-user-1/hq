import { PLUGINS, viewOf } from "@/lib/plugins";
import { installViaTmux } from "@/lib/plugin-install";

// Drives a real claude PTY — slow (~1 min) and stateful; never cache.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { id } — one-click install a /plugin plugin by driving a tmux-hosted claude
// session through the marketplace-add + install + confirm sequence. Returns the
// fresh view (re-detected installed state) + a log for debugging on failure.
export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    const def = PLUGINS.find((p) => p.id === id);
    if (!def) return Response.json({ error: `unknown plugin: ${id}` }, { status: 400 });
    if (!def.tmuxInstall)
      return Response.json({ error: `${id} has no one-click install` }, { status: 400 });

    const r = await installViaTmux({ ...def.tmuxInstall, cwd: process.cwd() });
    return Response.json({ ok: r.ok, error: r.error, log: r.log, plugin: viewOf(def) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "install failed" },
      { status: 500 },
    );
  }
}
