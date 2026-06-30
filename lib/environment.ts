import os from "node:os";

// Environment reader — surfaces a SAFE allowlist of the Node process's
// environment (the shell hq itself was launched with) as key/value pairs for the
// Environment panel. Same hq thesis, narrowed: read what's already there, never
// invent. We expose only well-known, non-sensitive keys (PATH/SHELL/HOME/LANG/
// TERM/NODE_ENV + the npm_*/CLAUDE_* families), and even within that allowlist we
// MASK any value whose KEY smells like a credential (token/key/secret/password/
// auth) so a stray CLAUDE_API_KEY or npm_*_token never lands on screen.

export type EnvVar = { key: string; value: string };

// Exact keys we always show, plus prefixes for the variable npm_*/CLAUDE_*
// families. Order here is the canonical display order for the exact keys.
const ALLOW_EXACT = ["PATH", "SHELL", "HOME", "LANG", "TERM", "NODE_ENV"];
const ALLOW_PREFIX = ["npm_", "CLAUDE_"];

// Any KEY matching this is a credential — mask its VALUE even though the key is
// allowlisted (e.g. CLAUDE_API_KEY, npm_config_*_authToken).
const SENSITIVE = /TOKEN|KEY|SECRET|PASSWORD|AUTH/i;
const MASK = "••••••••";

const isAllowed = (key: string): boolean =>
  ALLOW_EXACT.includes(key) || ALLOW_PREFIX.some((p) => key.startsWith(p));

// Sort: the canonical exact keys first (in ALLOW_EXACT order), then everything
// else (the npm_*/CLAUDE_* families) alphabetically.
function compareKeys(a: string, b: string): number {
  const ia = ALLOW_EXACT.indexOf(a);
  const ib = ALLOW_EXACT.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return a.localeCompare(b);
}

export function getEnvironment(): EnvVar[] {
  void os; // node:os imported to keep this file unambiguously server-only.
  const env = process.env;
  return Object.keys(env)
    .filter(isAllowed)
    .sort(compareKeys)
    .map((key) => {
      const raw = env[key] ?? "";
      return { key, value: SENSITIVE.test(key) ? MASK : raw };
    });
}
