import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// The Bucket Board's data lives in the vault, human-editable in Obsidian:
//   !hq/<launchpad>/003 Buckets.md
//
// A bucket = one cohesive single-pass over a shared working set. The honest
// fullness metric is COHESION (do the queued tasks touch the same files /
// subsystem?), NOT a task count — so this module parses each task's declared
// files and scores the bucket by how much its remaining tasks overlap, plus a
// load reading (summed cost vs a soft single-pass capacity). The verdict is the
// operator's two moves made visible: keep adding · send now · split.

const VAULT_HQ = path.join(os.homedir(), "vaults", "hq", "!hq");
const BUCKETS_FILE = "003 Buckets.md";

// Soft single-pass capacity, in cost units (S=1, M=2, L=3). ~6 = a comfortable
// one-pass batch before context starts to dilute. CALIBRATION KNOB.
const CAPACITY = 6;
const RIPE_AT = 4; // load at/after which a cohesive bucket is "ripe — send now"
const OVERFULL_AT = 9; // load past which even a cohesive bucket should split
const COHESION_FLOOR = 0.5; // below this, tasks are mixing contexts → split

export type Cost = "S" | "M" | "L";
const COST_WEIGHT: Record<Cost, number> = { S: 1, M: 2, L: 3 };

export type Task = {
  title: string;
  done: boolean;
  files: string[];
  cost: Cost;
};

export type BucketState =
  | "shipped"
  | "empty"
  | "filling" // green — cohesive, room to add
  | "ripe" // amber — cohesive and full enough, send now
  | "split" // red — mixing contexts, break it up
  | "overfull"; // red — cohesive but too big for one pass

export type Bucket = {
  title: string;
  tasks: Task[];
  // computed over the UNCHECKED tasks (the work that still has to ship):
  load: number; // summed cost weight
  capacity: number;
  cohesion: number; // 0..1 — pairwise shared-working-set density
  workingSet: string[]; // distinct files
  subsystems: string[]; // distinct subsystems (the shared-context buckets)
  state: BucketState;
  verdict: string; // human label for the state
  dispatchPrompt: string; // the "send all" batch prompt
};

function safeReadDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith("---\n")) return md;
  const end = md.indexOf("\n---\n", 4);
  return end === -1 ? md : md.slice(end + 5);
}

function readBucketsFile(): string | null {
  // The launchpad folder may carry a sort prefix (e.g. "*launchpad").
  const launchpad = safeReadDir(VAULT_HQ).find(
    (d) => d.isDirectory() && d.name.replace(/^[!*@_]/, "") === "launchpad"
  );
  if (!launchpad) return null;
  try {
    return fs.readFileSync(
      path.join(VAULT_HQ, launchpad.name, BUCKETS_FILE),
      "utf8"
    );
  } catch {
    return null;
  }
}

// The shared-context unit. Tasks "share context" when their files land in the
// same subsystem — the first two path segments (app/@console, app/ui) or the
// top folder for shallow paths (lib). Directory proximity, not byte-identity,
// is what makes a batch one mental model.
function subsystem(file: string): string {
  const parts = file.split("/").filter(Boolean);
  if (parts.length >= 3) return parts.slice(0, 2).join("/");
  if (parts.length === 2) return parts[0];
  return file;
}

function parseTask(line: string): Task | null {
  const m = line.match(/^\s*-\s*\[( |x|X)\]\s+(.*)$/);
  if (!m) return null;
  const done = m[1].toLowerCase() === "x";
  let rest = m[2];

  const files = [...rest.matchAll(/`([^`]+)`/g)].map((f) => f[1]);
  const cost = (rest.match(/~([SML])\b/)?.[1] as Cost) ?? "M";

  const title = rest
    .replace(/`[^`]+`/g, "")
    .replace(/~[SML]\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return { title, done, files, cost };
}

// Pairwise density: fraction of task-pairs that share a file or a subsystem.
// 1 task → trivially cohesive (1.0). 0 tasks → 1.0 (nothing to dilute).
function cohesionOf(tasks: Task[]): number {
  const n = tasks.length;
  if (n <= 1) return 1;
  const subs = tasks.map((t) => new Set(t.files.map(subsystem)));
  let edges = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const shared = [...subs[i]].some((s) => subs[j].has(s));
      if (shared) edges++;
    }
  }
  return edges / ((n * (n - 1)) / 2);
}

function buildPrompt(title: string, todo: Task[], subsystems: string[]): string {
  const lines = todo.map(
    (t, i) =>
      `${i + 1}. ${t.title}${t.files.length ? ` — files: ${t.files.join(", ")}` : ""}`
  );
  return [
    `Run the "${title}" bucket as one cohesive pass — these ${todo.length} task${
      todo.length === 1 ? "" : "s"
    } share a working set (${subsystems.join(", ")}):`,
    "",
    ...lines,
    "",
    "Read the shared files once, implement all of it in a single pass, verify the routes compile, then report.",
  ].join("\n");
}

function score(title: string, declaredStatus: string | null, tasks: Task[]): Bucket {
  const todo = tasks.filter((t) => !t.done);
  const load = todo.reduce((s, t) => s + COST_WEIGHT[t.cost], 0);
  const cohesion = cohesionOf(todo);
  const workingSet = [...new Set(todo.flatMap((t) => t.files))];
  const subsystems = [...new Set(todo.flatMap((t) => t.files.map(subsystem)))];

  let state: BucketState;
  let verdict: string;
  if (declaredStatus === "shipped" || (tasks.length > 0 && todo.length === 0)) {
    state = "shipped";
    verdict = "shipped";
  } else if (todo.length === 0) {
    state = "empty";
    verdict = "empty — nothing queued";
  } else if (cohesion < COHESION_FLOOR) {
    state = "split";
    verdict = "split — tasks are mixing contexts";
  } else if (load > OVERFULL_AT) {
    state = "overfull";
    verdict = "overfull — split into two passes";
  } else if (load >= RIPE_AT) {
    state = "ripe";
    verdict = "ripe — send as one pass";
  } else {
    state = "filling";
    verdict = "filling — cohesive, room to add";
  }

  return {
    title,
    tasks,
    load,
    capacity: CAPACITY,
    cohesion,
    workingSet,
    subsystems,
    state,
    verdict,
    dispatchPrompt: buildPrompt(title, todo, subsystems),
  };
}

export function getBuckets(): Bucket[] {
  const raw = readBucketsFile();
  if (!raw) return [];
  const body = stripFrontmatter(raw);

  const buckets: Bucket[] = [];
  // Split on `## ` headings; the slice before the first one is the intro blurb.
  const sections = body.split(/^##\s+/m).slice(1);
  for (const section of sections) {
    const lines = section.split("\n");
    const title = lines[0].trim();
    let declaredStatus: string | null = null;
    const tasks: Task[] = [];
    for (const line of lines.slice(1)) {
      const status = line.match(/^status:\s*(\w+)/i);
      if (status) {
        declaredStatus = status[1].toLowerCase();
        continue;
      }
      const task = parseTask(line);
      if (task) tasks.push(task);
    }
    if (title) buckets.push(score(title, declaredStatus, tasks));
  }
  return buckets;
}
