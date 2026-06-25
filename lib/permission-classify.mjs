// HQ auto-mode PERMISSION CLASSIFIER. When you drive a Claude Code session from
// HQ (the Live REPL), every tool-permission prompt routes through the shim
// (lib/repl-approve-mcp.mjs) → the daemon's registerPermission. Pinging you on
// every read-only call ("can I run `git status`?") is noise. This classifier
// auto-decides the safe ones and only ESCALATES the rest to an Approve/Deny card.
//
// The POLICY FILE (`~/.claude/hq/permission-policy.json`) is the editable source of
// truth: this module seeds it with DEFAULT_POLICY on first read, then honors your
// edits. classify() → 'allow' | 'deny' | 'ask'. Default when nothing matches is
// 'ask' (fail-safe — HQ never auto-runs something the policy doesn't cover).
//
// PLAIN .mjs (no TS, no `@/` imports) ON PURPOSE: it's imported by BOTH the Next
// side (via the lib/permission-policy.ts facade) AND the standalone REPL daemon
// (lib/repl-daemon.mjs), which runs on bare `node` with no TS toolchain. The
// classifier MUST live where the process lives — the permission decision resolves
// in the daemon, so it can't depend on Next being reachable. Pure node:fs/os/path.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** @typedef {"allow" | "deny" | "ask"} Verdict */
/**
 * @typedef {Object} PermissionPolicy
 * @property {string[]} allowTools        tool names auto-allowed outright (read-only / inert)
 * @property {string[]} allowBashPatterns Bash commands matching any (regex source) → allow
 * @property {string[]} denyTools         tool names auto-denied outright (checked first)
 * @property {string[]} denyBashPatterns  Bash commands matching any → deny (checked first)
 */

// Atomic write (temp→rename), see lib/atomic.ts for the rationale (CODE-REVIEW
// BUG-1). Inlined here rather than imported so this module stays dependency-free
// for the strip-types unit runner (`npm run test:permission`) and the bare-node
// daemon, neither of which can resolve extensionless relative imports.
function writeAtomic(file, data) {
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

// Conservative default: only unambiguously read-only tools + a short list of
// read-only Bash verbs auto-allow; Write/Edit/unknown always ask.
/** @type {PermissionPolicy} */
export const DEFAULT_POLICY = {
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

function policyDir() {
  return path.join(os.homedir(), ".claude", "hq");
}
export function policyPath() {
  return path.join(policyDir(), "permission-policy.json");
}

// Merge a (possibly partial) parsed object onto the defaults so a hand-edited file
// missing a key never crashes classify().
/** @param {Partial<PermissionPolicy>} p @returns {PermissionPolicy} */
function normalize(p) {
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
/** @returns {PermissionPolicy} */
export function readPolicy() {
  const p = policyPath();
  try {
    return normalize(JSON.parse(fs.readFileSync(p, "utf8")));
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

/** @param {PermissionPolicy} policy @returns {PermissionPolicy} */
export function writePolicy(policy) {
  const next = normalize(policy);
  writeAtomic(policyPath(), JSON.stringify(next, null, 2)); // atomic — CODE-REVIEW BUG-1
  return next;
}

// Pull the Bash command string out of the permission request. Claude Code sends
// the tool args either parsed (input.command) or as a truncated JSON preview.
/** @param {{ input?: Record<string, unknown>; input_preview?: string }} args @returns {string | null} */
function bashCommandOf(args) {
  const cmd = args.input?.command;
  if (typeof cmd === "string") return cmd;
  if (typeof args.input_preview === "string") {
    try {
      const obj = JSON.parse(args.input_preview);
      if (typeof obj.command === "string") return obj.command;
    } catch {
      /* not JSON — match the raw preview */
    }
    return args.input_preview;
  }
  return null;
}

/** @param {string[]} patterns @param {string} text @returns {boolean} */
function matchesAny(patterns, text) {
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
/** @param {string} cmd @returns {boolean} */
export function isUnsafeBash(cmd) {
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
/**
 * @param {{ tool_name?: string; input?: Record<string, unknown>; input_preview?: string }} args
 * @param {PermissionPolicy} [policy]
 * @returns {Verdict}
 */
export function classify(args, policy = readPolicy()) {
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
