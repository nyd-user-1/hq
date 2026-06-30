import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// SHARED TASK LIST — the dependency-aware task board behind Claude Code's
// TodoWrite / agent-teams work distribution. One dir per team (or per session,
// for the legacy single-session lists), keyed by the team id OR a full session
// UUID:
//
//   ~/.claude/tasks/<id>/
//       1.json, 2.json, 3.json …   ← one numbered file per task
//       .lock                       ← empty advisory lock (skip)
//       .highwatermark              ← bookkeeping (skip)
//
// OBSERVED on disk (each <n>.json):
//   {
//     "id": "2",
//     "subject": "Write reader",
//     "description": "Write reader (depends on Design schema)",
//     "activeForm": "Writing the reader",   // present in some, absent in others
//     "status": "pending",                  // "pending" | "in_progress" | "completed"
//     "blocks": [],                          // task ids THIS task blocks (downstream)
//     "blockedBy": ["1"]                     // task ids blocking THIS task (upstream deps)
//   }
//
// There is NO assignee/assignedTo field on disk in the records I inspected —
// dependencies are expressed purely as blocks/blockedBy id graphs. The reader
// returns [] gracefully when the dir is absent.

const TASKS_ROOT = path.join(os.homedir(), ".claude", "tasks");

export type TaskStatus = "pending" | "in_progress" | "completed";

export type Task = {
  teamId: string; // the tasks/<id> dir this came from (set by the reader)
  id: string; // numeric-string id, also the filename stem
  subject: string; // short title
  description: string; // longer body (often equal to subject)
  activeForm: string; // present-tense label ("Writing the reader"); "" when absent
  status: TaskStatus;
  blocks: string[]; // ids this task blocks (downstream dependents)
  blockedBy: string[]; // ids this task is blocked by (upstream dependencies)
};

type RawTask = {
  id?: string;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: string;
  blocks?: unknown;
  blockedBy?: unknown;
};

function asIdArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function asStatus(v: unknown): TaskStatus {
  return v === "in_progress" || v === "completed" ? v : "pending";
}

// Every task in a team's (or session's) shared list, ordered by numeric id.
// Returns [] when the dir is absent (the common case) — defensive per-file so
// one bad record doesn't drop the rest.
export function tasksForTeam(teamId: string): Task[] {
  if (!teamId) return [];
  const dir = path.join(TASKS_ROOT, teamId);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // no dir for this id
  }
  const out: Task[] = [];
  for (const f of names) {
    // Only the numbered task files; skip .lock, .highwatermark and any dotfile.
    if (f.startsWith(".") || !f.endsWith(".json")) continue;
    let raw: RawTask;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue; // unreadable / mid-write — skip
    }
    const id = raw?.id != null ? String(raw.id) : f.replace(/\.json$/, "");
    out.push({
      teamId,
      id,
      subject: raw?.subject || "",
      description: raw?.description || "",
      activeForm: raw?.activeForm || "",
      status: asStatus(raw?.status),
      blocks: asIdArray(raw?.blocks),
      blockedBy: asIdArray(raw?.blockedBy),
    });
  }
  // Numeric id order (the files are 1.json, 2.json …); fall back to string sort
  // for any non-numeric id so the order is always deterministic.
  return out.sort((a, b) => {
    const na = Number(a.id);
    const nb = Number(b.id);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.id.localeCompare(b.id);
  });
}
