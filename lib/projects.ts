import { getRecentSessions, type RecentSession } from "./sessions";

// Projects = interactive sessions grouped by their derived `project` — the SAME
// field the Recents "Project" group-by uses (launch folder `/code/<slug>`, else an
// early `code/<slug>` text reference, else "Unassigned"; see lib/sessions.ts). This
// is the read-only, auto-derived layer. Curated projects ("Add to project",
// named containers via a ~/.claude/hq sidecar) are a later step.

export type ProjectSummary = {
  name: string;
  sessions: number; // count in the last 7 days
  lastActive: number; // most-recent session mtime
  active: boolean; // any session active within the cache window
};

export function getProjects(): ProjectSummary[] {
  // High limit = "all interactive sessions in the window"; recentFiles already
  // caps at the last 7 days, so this rarely binds.
  const recents = getRecentSessions(1000);
  const map = new Map<string, ProjectSummary>();
  for (const s of recents) {
    const name = s.project || "Unassigned";
    const cur = map.get(name);
    if (cur) {
      cur.sessions += 1;
      cur.lastActive = Math.max(cur.lastActive, s.lastActive);
      cur.active = cur.active || s.active;
    } else {
      map.set(name, {
        name,
        sessions: 1,
        lastActive: s.lastActive,
        active: s.active,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.lastActive - a.lastActive);
}

// All interactive sessions whose derived project matches `name` (newest first) —
// the drill-down when you click a project card.
export function getProjectSessions(name: string): RecentSession[] {
  return getRecentSessions(1000).filter(
    (s) => (s.project || "Unassigned") === name
  );
}
