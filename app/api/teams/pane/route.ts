import { memberPaneId, capturePane, sendToPane } from "@/lib/team-tmux";

export const dynamic = "force-dynamic";

// The DRIVE path for a tmux-split-pane teammate.
//   GET  ?team=<id>&member=<name> → { paneId, pane }  (its live terminal text)
//   POST { team, member, text }   → { ok }            (type into its real stdin)
// Returns { paneId: null } when the teammate isn't a tmux pane (in-process mode),
// so the UI can fall back to the read-only transcript view.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const team = url.searchParams.get("team") ?? "";
  const member = url.searchParams.get("member") ?? "";
  const paneId = memberPaneId(team, member);
  if (!paneId) return Response.json({ paneId: null, pane: null });
  return Response.json({ paneId, pane: capturePane(paneId) });
}

export async function POST(req: Request) {
  const { team, member, text } = await req
    .json()
    .catch(() => ({}) as { team?: string; member?: string; text?: string });
  if (!team || !member) return Response.json({ ok: false, error: "team + member required" }, { status: 400 });
  const paneId = memberPaneId(team, member);
  if (!paneId)
    return Response.json({ ok: false, error: "teammate is not a tmux pane (in-process mode — not directly drivable)" });
  return Response.json(sendToPane(paneId, text ?? ""));
}
