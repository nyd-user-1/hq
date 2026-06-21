// HQ auto-mode PERMISSION CLASSIFIER. When you drive a Claude Code session from
// HQ (the Live REPL — lib/repl.ts), every tool-permission prompt routes through
// the shim (lib/repl-approve-mcp.mjs) → registerPermission(). Pinging you on every
// read-only call ("can I run `git status`?") is noise. This classifier auto-decides
// the safe ones and only ESCALATES the rest to an Approve/Deny card.
//
// The POLICY FILE (`~/.claude/hq/permission-policy.json`) is the editable source of
// truth: this module seeds it with DEFAULT_POLICY on first read, then honors your
// edits. classify() → 'allow' | 'deny' | 'ask'. Default when nothing matches is
// 'ask' (fail-safe — HQ never auto-runs something the policy doesn't cover).
//
// Pure node:fs/os/path. Zero browser deps. Mirrors the other lib/*.ts readers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type Verdict = "allow" | "deny" | "ask";

// Atomic write (temp→rename), see lib/atomic.ts for the rationale (CODE-REVIEW
// BUG-1). Inlined here rather than imported so this module stays dependency-free
// for the strip-types unit runner (`npm run test:permission`), which can't
// resolve extensionless relative imports the way the Next bundler does.
function writeAtomic(file: string, data: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing to clean up */
    }
    throw e;
  }
}

export type PermissionPolicy = {
  allowTools: string[]; // tool names auto-allowed outright (read-only / inert)
  allowBashPatterns: string[]; // Bash commands matching any (regex source) → allow
  denyTools: string[]; // tool names auto-denied outright (checked first)
  denyBashPatterns: string[]; // Bash commands matching any → deny (checked first)
};

// Conservative default: only unambiguously read-only tools + a short list of
// read-only Bash verbs auto-allow; Write/Edit/unknown always ask.
export const DEFAULT_POLICY: PermissionPolicy = {
  allowTools: ["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "WebFetch", "WebSearch"],
  allowBashPatterns: [
    "^git (status|diff|log|show|branch|remote|stash list|rev-parse|describe|blame|shortlog)\\b",
    "^(ls|cat|pwd|echo|head|tail|wc|file|stat|tree|find|which|whoami|date|printenv|du|df)\\b",
    "^(npm (ls|list|view|outdated|run lint|run test|test)|node --version|npm --version|npx tsc --noEmit)\\b",
    "^(grep|rg|ag|ack|sort|uniq|cut|awk|sed -n)\\b",
  ],
  denyTools: [],
  denyBashPatterns: [],
};

function policyDir(): string {
  return path.join(os.homedir(), ".claude", "hq");
}
export function policyPath(): string {
  return path.join(policyDir(), "permission-policy.json");
}

// Merge a (possibly partial) parsed object onto the defaults so a hand-edited file
// missing a key never crashes classify().
function normalize(p: Partial<PermissionPolicy>): PermissionPolicy {
  return {
    allowTools: Array.isArray(p.allowTools) ? p.allowTools : DEFAULT_POLICY.allowTools,
    allowBashPatterns: Array.isArray(p.allowBashPatterns)
      ? p.allowBashPatterns
      : DEFAULT_POLICY.allowBashPatterns,
    denyTools: Array.isArray(p.denyTools) ? p.denyTools : DEFAULT_POLICY.denyTools,
    denyBashPatterns: Array.isArray(p.denyBashPatterns)
      ? p.denyBashPatterns
      : DEFAULT_POLICY.denyBashPatterns,
  };
}

// Read the policy, seeding the file with DEFAULT_POLICY on first read (so it's
// discoverable + editable). A corrupt file falls back to the default IN MEMORY —
// never silently overwrites a file you may have hand-edited.
export function readPolicy(): PermissionPolicy {
  const p = policyPath();
  try {
    return normalize(JSON.parse(fs.readFileSync(p, "utf8")) as Partial<PermissionPolicy>);
  } catch {
    try {
      fs.mkdirSync(policyDir(), { recursive: true });
      if (!fs.existsSync(p)) writeAtomic(p, JSON.stringify(DEFAULT_POLICY, null, 2));
    } catch {
      /* best-effort seed; classify still works off the in-memory default */
    }
    return { ...DEFAULT_POLICY };
  }
}

export function writePolicy(policy: PermissionPolicy): PermissionPolicy {
  const next = normalize(policy);
  writeAtomic(policyPath(), JSON.stringify(next, null, 2)); // atomic — CODE-REVIEW BUG-1
  return next;
}

// Pull the Bash command string out of the permission request. Claude Code sends
// the tool args either parsed (input.command) or as a truncated JSON preview.
function bashCommandOf(args: { input?: Record<string, unknown>; input_preview?: string }): string | null {
  const cmd = args.input?.command;
  if (typeof cmd === "string") return cmd;
  if (typeof args.input_preview === "string") {
    try {
      const obj = JSON.parse(args.input_preview) as { command?: unknown };
      if (typeof obj.command === "string") return obj.command;
    } catch {
      /* not JSON — match the raw preview */
    }
    return args.input_preview;
  }
  return null;
}

function matchesAny(patterns: string[], text: string): boolean {
  for (const src of patterns) {
    try {
      if (new RegExp(src).test(text)) return true;
    } catch {
      /* a bad regex in the policy file shouldn't blow up classification */
    }
  }
  return false;
}

// The read-only allow patterns are prefix-anchored (`^echo\b`), which a chained
// or expanded command can slip past (`echo hi; rm -rf x` matches ^echo). This
// guard runs in CODE — before the policy's allow list and regardless of what a
// (possibly stale or hand-edited) policy file says — so the escalation can't be
// configured away (CODE-REVIEW SEC-5).
export function isUnsafeBash(cmd: string): boolean {
  // Shell metacharacters → chaining / command substitution / redirection.
  if (/[;&|`$(){}<>\n]/.test(cmd)) return true;
  // Prefixes that execute or delete despite a benign-looking first token:
  // `env CMD`, `xargs`, `sudo`, `eval`, `exec`, `source`, `.` all run an argument
  // as a command.
  if (/^\s*(env|xargs|sudo|eval|exec|source|\.)\b/.test(cmd)) return true;
  // `find` is read-only EXCEPT its action flags, which run programs / delete.
  if (
    /^\s*find\b/.test(cmd) &&
    /\s-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)\b/.test(cmd)
  )
    return true;
  return false;
}

// The classifier. Order: hard denies first, then allows, then default-ask. The
// command is trimmed so leading model whitespace can't dodge the read-only patterns.
export function classify(
  args: { tool_name?: string; input?: Record<string, unknown>; input_preview?: string },
  policy: PermissionPolicy = readPolicy(),
): Verdict {
  const tool = args.tool_name ?? "";
  if (tool && policy.denyTools.includes(tool)) return "deny";
  if (tool === "Bash") {
    const cmd = bashCommandOf(args);
    if (cmd != null) {
      const trimmed = cmd.trim();
      if (matchesAny(policy.denyBashPatterns, trimmed)) return "deny";
      if (isUnsafeBash(trimmed)) return "ask"; // metachars / exec-prefix → never auto-allow (SEC-5)
      if (matchesAny(policy.allowBashPatterns, trimmed)) return "allow";
    }
    return "ask"; // unknown / non-read-only Bash → escalate
  }
  if (tool && policy.allowTools.includes(tool)) return "allow";
  return "ask"; // Write / Edit / MultiEdit / unknown → ask the human
}
