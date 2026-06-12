import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Operator routines, vault-defined, organized by the CADENCE model:
//   on-demand · local · cloud · agent
// HQ doesn't own a live cron registry, so routines are intentions declared in
// the vault (!hq/<launchpad>/004 Routines.md) with /schedule wired as the
// actuator: on-demand fires the prompt now; the rest hand off to /schedule,
// which is the skill that actually creates a scheduled cloud agent.

const VAULT_HQ = path.join(os.homedir(), "vaults", "hq", "!hq");
const ROUTINES_FILE = "004 Routines.md";

export type Cadence = "on-demand" | "local" | "cloud" | "agent";

export const CADENCE_ORDER: Cadence[] = [
  "on-demand",
  "local",
  "cloud",
  "agent",
];

export const CADENCE_BLURB: Record<Cadence, string> = {
  "on-demand": "you fire it",
  local: "cron on this machine",
  cloud: "a /schedule cloud agent",
  agent: "an autonomous loop",
};

export type Routine = {
  cadence: Cadence;
  title: string;
  schedule: string; // "daily 9am", "weekly Mon", "—"
  prompt: string;
  dispatch: string; // what gets POSTed to /api/terminal
  immediate: boolean; // true = run the prompt now; false = hand to /schedule
};

function safeReadDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readRoutinesFile(): string | null {
  const launchpad = safeReadDir(VAULT_HQ).find(
    (d) => d.isDirectory() && d.name.replace(/^[!*@_]/, "") === "launchpad"
  );
  if (!launchpad) return null;
  try {
    return fs.readFileSync(
      path.join(VAULT_HQ, launchpad.name, ROUTINES_FILE),
      "utf8"
    );
  } catch {
    return null;
  }
}

// Line:  - [cadence] Title @ schedule :: prompt
function parseRoutine(line: string): Routine | null {
  const m = line.match(
    /^\s*-\s*\[(on-demand|local|cloud|agent)\]\s*(.+?)\s*@\s*(.+?)\s*::\s*(.+)$/i
  );
  if (!m) return null;
  const cadence = m[1].toLowerCase() as Cadence;
  const title = m[2].trim();
  const schedule = m[3].trim();
  const prompt = m[4].trim();
  const immediate = cadence === "on-demand";
  const when = schedule && schedule !== "—" ? `, ${schedule}` : "";
  const dispatch = immediate
    ? prompt
    : `/schedule ${title} — ${prompt} (cadence: ${cadence}${when})`;
  return { cadence, title, schedule, prompt, dispatch, immediate };
}

export function getRoutines(): Routine[] {
  const raw = readRoutinesFile();
  if (!raw) return [];
  return raw
    .split("\n")
    .map(parseRoutine)
    .filter((r): r is Routine => r !== null);
}
