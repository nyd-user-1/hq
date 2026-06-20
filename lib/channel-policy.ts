// HQ Channel auto-mode CLASSIFIER. When HQ drives a Claude Code session over a
// channel (see lib/channel.ts + scripts/channel/hq-channel.mjs), Claude Code
// relays every tool-permission prompt to the channel server. Pinging the human
// on every read-only call is noise — so this classifier auto-decides the safe
// ones and only escalates the rest.
//
// The POLICY FILE (`~/.claude/hq/channel-policy.json`) is the shared source of
// truth: this module reads/writes it, and the sidecar .mjs reads the SAME file
// and applies the SAME ruleset (duplicated there because the .mjs can't import a
// TS module — keep the two in sync; the patterns below ARE the contract).
//
// classify() returns 'allow' | 'deny' | 'ask'. Default behavior when nothing
// matches is 'ask' (escalate to the human) — fail-safe, never auto-run.
//
// Pure node:fs/os/path. Zero browser deps. Mirrors the other lib/*.ts readers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Verdict = "allow" | "deny" | "ask";

export type ChannelPolicy = {
  // Tool names auto-allowed outright (read-only / inert tools).
  allowTools: string[];
  // Bash commands are matched against these regex SOURCES (anchored, case-sensitive
  // unless the pattern says otherwise). A match → allow. Stored as strings so the
  // policy is editable as plain JSON.
  allowBashPatterns: string[];
  // Tool names auto-DENIED outright (e.g. obviously destructive tools you never
  // want HQ to greenlight unattended). Empty by default.
  denyTools: string[];
  // Bash commands matching these → auto-deny (a hard block, checked BEFORE allow).
  denyBashPatterns: string[];
};

// The default policy. Conservative: only unambiguously read-only / inspection
// tools and a short list of read-only Bash verbs auto-allow; everything else asks.
export const DEFAULT_POLICY: ChannelPolicy = {
  allowTools: ["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "WebFetch", "WebSearch"],
  allowBashPatterns: [
    // Read-only git inspection.
    "^git (status|diff|log|show|branch|remote|stash list|rev-parse|describe|blame|shortlog)\\b",
    // Read-only filesystem / shell inspection.
    "^(ls|cat|pwd|echo|head|tail|wc|file|stat|tree|find|which|whoami|date|env|printenv|du|df)\\b",
    // Read-only package / tooling queries.
    "^(npm (ls|list|view|outdated|run lint|run test|test)|node --version|npm --version|npx tsc --noEmit)\\b",
    // Grep-family read-only.
    "^(grep|rg|ag|ack|sort|uniq|cut|awk|sed -n)\\b",
  ],
  denyTools: [],
  denyBashPatterns: [],
};

function policyDir(): string {
  return path.join(os.homedir(), ".claude", "hq");
}
function policyPath(): string {
  return path.join(policyDir(), "channel-policy.json");
}

// Read the policy, creating the file with DEFAULT_POLICY on first read (so the
// user has something to edit). Tolerates a corrupt file by falling back to the
// default IN MEMORY (never silently overwrites a file the user may have hand-edited).
export function readPolicy(): ChannelPolicy {
  const p = policyPath();
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<ChannelPolicy>;
    return normalize(parsed);
  } catch {
    // Missing file → seed it with the default so it's discoverable + editable.
    try {
      fs.mkdirSync(policyDir(), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(DEFAULT_POLICY, null, 2));
    } catch {
      /* best-effort seed; classify still works off the in-memory default */
    }
    return { ...DEFAULT_POLICY };
  }
}

// Merge a (possibly partial) parsed object onto the defaults so a hand-edited
// file missing a key never crashes classify().
function normalize(p: Partial<ChannelPolicy>): ChannelPolicy {
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

export function writePolicy(policy: ChannelPolicy): ChannelPolicy {
  const next = normalize(policy);
  fs.mkdirSync(policyDir(), { recursive: true });
  fs.writeFileSync(policyPath(), JSON.stringify(next, null, 2));
  return next;
}

// Pull the bash command string out of the permission request. Claude Code sends
// the tool args either parsed (input.command) or as a JSON string (input_preview).
function bashCommandOf(args: { input?: Record<string, unknown>; input_preview?: string }): string | null {
  const cmd = args.input?.command;
  if (typeof cmd === "string") return cmd;
  if (typeof args.input_preview === "string") {
    // input_preview is the args as JSON (truncated to ~200 chars). Try to parse a
    // command field out of it; fall back to the raw string for pattern-matching.
    try {
      const obj = JSON.parse(args.input_preview) as { command?: unknown };
      if (typeof obj.command === "string") return obj.command;
    } catch {
      /* not JSON — match against the raw preview below */
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

// The classifier. Order: hard denies first (deny tools, deny bash), then allows
// (allow tools, allow bash), then default-ask. A trimmed command is matched so
// leading whitespace from the model doesn't dodge the read-only patterns.
export function classify(
  args: { tool_name?: string; input?: Record<string, unknown>; input_preview?: string },
  policy: ChannelPolicy = readPolicy(),
): Verdict {
  const tool = args.tool_name ?? "";

  // Hard denies win.
  if (tool && policy.denyTools.includes(tool)) return "deny";

  if (tool === "Bash") {
    const cmd = bashCommandOf(args);
    if (cmd != null) {
      const trimmed = cmd.trim();
      if (matchesAny(policy.denyBashPatterns, trimmed)) return "deny";
      if (matchesAny(policy.allowBashPatterns, trimmed)) return "allow";
    }
    // Unknown / non-read-only Bash → escalate.
    return "ask";
  }

  if (tool && policy.allowTools.includes(tool)) return "allow";

  // Everything else (Write, Edit, MultiEdit, unknown tools) → ask the human.
  return "ask";
}

export { policyPath };
