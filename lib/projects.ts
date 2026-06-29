import { getRecentSessions, type RecentSession } from "./sessions";

// Projects = interactive sessions grouped by their derived `project` — the SAME
// field the Recents "Project" group-by uses (launch folder `/code/<slug>`, else an
// early `code/<slug>` text reference, else "Unassigned"; see lib/sessions.ts). This
// is the read-only, auto-derived layer. Curated projects ("Add to project",
// named containers via a ~/.claude/hq sidecar) are a later step.

export type ProjectSummary = {
  name: string;
  sessions: number; // all-time interactive session count
  lastActive: number; // most-recent session mtime
  active: boolean; // any session active within the cache window
};

export function getProjects(): ProjectSummary[] {
  // ALL-TIME (maxAge = Infinity), not the 7-day recents window — a "Projects" view
  // should list every project you've ever worked in, not just this week's. Head-only
  // scan (lighter than getAllSessionsFull). High limit ⇒ effectively uncapped.
  const recents = getRecentSessions(100000, Infinity);
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
// the drill-down when you click a project card. All-time, to match getProjects.
export function getProjectSessions(name: string): RecentSession[] {
  return getRecentSessions(100000, Infinity).filter(
    (s) => (s.project || "Unassigned") === name
  );
}
