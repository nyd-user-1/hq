// HQ permission classifier — TYPED FACADE.
//
// The implementation moved to lib/permission-classify.mjs (plain .mjs) so the
// standalone REPL daemon (lib/repl-daemon.mjs), which runs on bare `node` with no
// TS toolchain, can import the exact same classifier the Next side uses — one
// source of truth, no drift, and the permission decision never depends on Next
// being reachable. This file re-exports that runtime for `@/lib/permission-policy`
// consumers and re-declares the TS types (the .mjs documents them as JSDoc).
export {
  classify,
  readPolicy,
  writePolicy,
  policyPath,
  isUnsafeBash,
  DEFAULT_POLICY,
} from "./permission-classify.mjs";

export type Verdict = "allow" | "deny" | "ask";

export type PermissionPolicy = {
  allowTools: string[]; // tool names auto-allowed outright (read-only / inert)
  allowBashPatterns: string[]; // Bash commands matching any (regex source) → allow
  denyTools: string[]; // tool names auto-denied outright (checked first)
  denyBashPatterns: string[]; // Bash commands matching any → deny (checked first)
};
