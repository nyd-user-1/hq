import { memberPaneId, capturePane, sendToPane } from "@/lib/team-tmux";
import { teams } from "@/lib/teams";

export const dynamic = "force-dynamic";

// The DRIVE path for a tmux-split-pane teammate, plus the member metadata the wall
// pane needs to label itself (color/agentType/isLead — the "@tm:" token carries
// none of it).
//   GET  ?team=<id>&member=<name> → { paneId, pane, name, color, agentType, isLead }
//   POST { team, member, text }   → { ok }            (type into its real stdin)
// paneId is null when the teammate isn't a tmux pane (in-process mode) — the UI
// then falls back to the read-only transcript view, but still gets the metadata.
function memberMeta(team: string, member: string) {
  const t = teams().find((x) => x.id === team);
  const m = t?.members.find((x) => x.name === member);
  return {
    name: member,
    color: m?.color ?? "",
    agentType: m?.agentType ?? "",
    isLead: m?.isLead ?? false,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const team = url.searchParams.get("team") ?? "";
  const member = url.searchParams.get("member") ?? "";
  const meta = memberMeta(team, member);
  const paneId = memberPaneId(team, member);
  if (!paneId) return Response.json({ paneId: null, pane: null, ...meta });
  return Response.json({ paneId, pane: capturePane(paneId), ...meta });
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
