// Server bootstrap (Next auto-loads this once per server process). HQ's one
// non-negotiable: the local Claude Code docs mirror (~/.claude/hq/docs) must
// always match the real docs. warmDocs() already refreshes on every Search /⌘K
// use, but that only fires when you USE search — so here we GUARANTEE it: refresh
// on boot, then re-check every 6h for the life of the (launchd-durable) server.
// warmDocs() no-ops while the mirror is <24h fresh and sends conditional GETs, so
// re-pulls cost almost nothing; the point is the mirror can never silently rot.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warmDocs } = await import("@/lib/docs");
  warmDocs();
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => warmDocs(), SIX_HOURS).unref?.();
}
