import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// PERMISSIONS — the allow / ask / deny rules + the default permission mode that
// govern what Claude Code runs WITHOUT asking. They live in ~/.claude/settings.json
// under `permissions`. This is hq's control surface over them: read every rule,
// flag the dangerous ones, and (the write half) move a rule between buckets, remove
// it, or change the default mode — so you manage the 478 instead of meeting them in
// a midnight trust dialog.
//
// We READ + WRITE the user-global file (where the bulk live). Atomic tmp→rename so
// an interrupted write can never truncate your settings; all OTHER keys preserved.

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const SETTINGS = path.join(CLAUDE_DIR, "settings.json");

export type Bucket = "allow" | "ask" | "deny";
export type PermCategory = "bash" | "mcp" | "tool";

export type PermRule = {
  rule: string; // the raw rule string, e.g. "Bash(git push *)" or "mcp__x__y"
  bucket: Bucket;
  category: PermCategory;
  dangerous: boolean; // destructive / irreversible / outbound — risky to auto-allow
};

export type PermState = {
  defaultMode: string; // default · auto · acceptEdits · plan · bypassPermissions
  rules: PermRule[];
  counts: { allow: number; ask: number; deny: number; dangerousAllowed: number };
};

// Heuristics for "you probably don't want this running silently": destructive shell,
// outbound, and write/irreversible MCP operations. Conservative — better to flag and
// let you dismiss than to miss a `complete_database_migration` in `allow`.
const DANGER = [
  /\brm\b/, /\bsudo\b/, /git\s+push/, /reset\s+--hard/, /git\s+clean/, /\bdd\b/, /mkfs/,
  /curl[^|]*\|\s*(sh|bash)/, /npm\s+publish/, /\bchmod\b/, /\bkill\b/,
  /migration/i, /\bdelete\b/i, /\bdrop\b/i, /execute_sql/i, /run_sql/i, /deploy/i,
  /create_/i, /update_/i, /remove_/i, /send_/i, /merge_/i, /provision/i, /restore/i, /reset_/i,
];

function categorize(rule: string): PermCategory {
  if (rule.startsWith("mcp__")) return "mcp";
  if (/^Bash\b/.test(rule)) return "bash";
  return "tool";
}

function isDangerous(rule: string): boolean {
  return DANGER.some((re) => re.test(rule));
}

type Settings = { permissions?: { allow?: string[]; ask?: string[]; deny?: string[]; defaultMode?: string } };

function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export function getPermissions(): PermState {
  const p = readSettings().permissions ?? {};
  const buckets: Bucket[] = ["allow", "ask", "deny"];
  const rules: PermRule[] = [];
  for (const b of buckets) {
    for (const r of p[b] ?? []) {
      rules.push({ rule: r, bucket: b, category: categorize(r), dangerous: isDangerous(r) });
    }
  }
  const dangerousAllowed = rules.filter((r) => r.bucket === "allow" && r.dangerous).length;
  return {
    defaultMode: p.defaultMode ?? "default",
    rules,
    counts: {
      allow: (p.allow ?? []).length,
      ask: (p.ask ?? []).length,
      deny: (p.deny ?? []).length,
      dangerousAllowed,
    },
  };
}

// Read-modify-write the FULL settings object (preserving every other key), atomic.
function mutate(fn: (s: Settings) => void): PermState {
  let s: Settings;
  try {
    s = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  } catch {
    s = {};
  }
  s.permissions = s.permissions ?? {};
  fn(s);
  const tmp = `${SETTINGS}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n");
  fs.renameSync(tmp, SETTINGS);
  return getPermissions();
}

// Move a rule into a bucket (allow/ask/deny) or "remove" it entirely. A rule lives
// in at most one bucket, so we strip it from all three first, then add it back.
export function setRuleBucket(rule: string, bucket: Bucket | "remove"): PermState {
  return mutate((s) => {
    const p = s.permissions!;
    for (const b of ["allow", "ask", "deny"] as Bucket[]) {
      p[b] = (p[b] ?? []).filter((r) => r !== rule);
    }
    if (bucket !== "remove") {
      p[bucket] = [...(p[bucket] ?? []), rule];
    }
  });
}

const VALID_MODES = new Set(["default", "auto", "acceptEdits", "plan", "bypassPermissions"]);

export function setDefaultMode(mode: string): PermState {
  if (!VALID_MODES.has(mode)) throw new Error(`invalid mode: ${mode}`);
  return mutate((s) => {
    s.permissions!.defaultMode = mode;
  });
}
