import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Session lineage: which sessions continue which. A /clear ends one session
// file and births a new one whose first real record IS the /clear command —
// so a "clear-born" session's predecessor is the same-cwd session that was
// being written right up to that moment. No explicit edge exists in the
// transcripts; this is the same-cwd + /clear-adjacency heuristic.

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// A predecessor must have been written to within this window before the
// /clear — filters out long-dead same-project sessions.
const ADJACENCY_MS = 60 * 60 * 1000;

export type LineageNode = {
  id: string;
  project: string;
  bornAt: number; // first timestamped entry (for a clear-born session: the /clear moment)
  lastActive: number; // file mtime
};

type Meta = LineageNode & { cwd: string | null; clearBorn: boolean };

type Head = { cwd: string | null; firstTs: number; clearBorn: boolean };

// A transcript's head never changes once written — cache per path for the
// process lifetime (the turns route polls at 1s while a turn is in flight).
const headCache = new Map<string, Head>();

function readHead(file: string): Head {
  const hit = headCache.get(file);
  if (hit) return hit;
  let text: string;
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(16 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    text = buf.toString("utf8", 0, n);
  } catch {
    return { cwd: null, firstTs: 0, clearBorn: false };
  }
  let cwd: string | null = null;
  let firstTs = 0;
  let decided = false;
  let clearBorn = false;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof e.cwd === "string") cwd = e.cwd;
    if (!firstTs && typeof e.timestamp === "string") {
      const t = Date.parse(e.timestamp);
      if (!Number.isNaN(t)) firstTs = t;
    }
    if (!decided && (e.type === "user" || e.type === "assistant")) {
      const c = e.message?.content;
      const raw =
        typeof c === "string"
          ? c
          : Array.isArray(c)
            ? c
                .map((b) => (b?.type === "text" ? (b.text ?? "") : ""))
                .join("\n")
            : "";
      // The caveat record precedes the command record — skip it, don't decide.
      if (raw.includes("<local-command-caveat>")) continue;
      decided = true;
      clearBorn =
        e.type === "user" && raw.includes("<command-name>/clear</command-name>");
    }
    if (cwd && firstTs && decided) break;
  }
  const head = { cwd, firstTs, clearBorn };
  if (decided) headCache.set(file, head); // a brand-new file may still be mid-write
  return head;
}

function scan(): Meta[] {
  const now = Date.now();
  const out: Meta[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    let names: string[];
    try {
      names = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dirPath, f);
      let mtime: number;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtime > WEEK_MS) continue;
      const { cwd, firstTs, clearBorn } = readHead(full);
      out.push({
        id: f.slice(0, -6),
        project:
          cwd === os.homedir() ? "~" : cwd ? path.basename(cwd) : dir.name,
        bornAt: firstTs,
        lastActive: mtime,
        cwd,
        clearBorn,
      });
    }
  }
  return out;
}

export type Lineage = {
  chain: LineageNode[] | null; // the full tied chain, oldest → newest (null unless ≥ 2)
  predecessor: LineageNode | null; // the session this one continues
  successor: LineageNode | null; // the session that continues this one
};

export function lineageFor(id: string): Lineage {
  const all = scan();
  const me = all.find((m) => m.id === id);
  if (!me) return { chain: null, predecessor: null, successor: null };

  // Parent of a clear-born session: the same-cwd session born earlier that was
  // still being written near the /clear moment; latest-born such session wins.
  const parentOf = (m: Meta): Meta | null => {
    if (!m.clearBorn || !m.cwd || !m.bornAt) return null;
    let best: Meta | null = null;
    for (const c of all) {
      if (c.id === m.id || c.cwd !== m.cwd) continue;
      if (!c.bornAt || c.bornAt >= m.bornAt) continue;
      if (c.lastActive < m.bornAt - ADJACENCY_MS) continue;
      if (!best || c.bornAt > best.bornAt) best = c;
    }
    return best;
  };
  // Child: the session whose parent is m; if several (re-cleared), follow the
  // most recently active one — that's the line the user actually continued.
  const childOf = (m: Meta): Meta | null => {
    let best: Meta | null = null;
    for (const c of all) {
      if (parentOf(c)?.id !== m.id) continue;
      if (!best || c.lastActive > best.lastActive) best = c;
    }
    return best;
  };

  const strip = ({ id, project, bornAt, lastActive }: Meta): LineageNode => ({
    id,
    project,
    bornAt,
    lastActive,
  });

  const chain: Meta[] = [me];
  const seen = new Set([me.id]);
  for (let p = parentOf(me); p && !seen.has(p.id); p = parentOf(p)) {
    chain.unshift(p);
    seen.add(p.id);
  }
  for (let c = childOf(me); c && !seen.has(c.id); c = childOf(c)) {
    chain.push(c);
    seen.add(c.id);
  }

  const pred = parentOf(me);
  const succ = childOf(me);
  return {
    chain: chain.length >= 2 ? chain.map(strip) : null,
    predecessor: pred ? strip(pred) : null,
    successor: succ ? strip(succ) : null,
  };
}
