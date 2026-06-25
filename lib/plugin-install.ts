import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Install a Claude Code plugin via the NON-INTERACTIVE CLI:
//   claude plugin marketplace add <owner/repo>
//   claude plugin install <plugin@marketplace> --scope user
// The `/plugin` SLASH command is a TUI (needs a PTY); the `claude plugin …`
// SUBCOMMAND is headless — verified 2026-06-25. The authoritative installed state
// lives in ~/.claude/settings.json `enabledPlugins` (see lib/plugins.ts), so the
// caller re-detects there rather than trusting CLI stdout.

const HOME = os.homedir();

function resolveBin(name: string, candidates: string[]): string {
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* keep looking */
    }
  }
  return name; // rely on PATH
}
const claudeBin = () =>
  process.env.HQ_CLAUDE_BIN ||
  resolveBin("claude", [
    path.join(HOME, ".npm-global/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(HOME, ".local/bin/claude"),
    path.join(HOME, ".bun/bin/claude"),
  ]);

export type InstallResult = { error?: string; log: string };

function run(args: string[]): { out: string; err?: string } {
  try {
    const out = execFileSync(claudeBin(), args, {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { out: (err.stdout || "") + (err.stderr || ""), err: err.stderr || err.message || String(e) };
  }
}

export function installPlugin(opts: { marketplace: string; ref: string }): InstallResult {
  const log: string[] = [];
  // marketplace add — idempotent ("already exists" is fine, we don't fail on it)
  const m = run(["plugin", "marketplace", "add", opts.marketplace]);
  log.push(`$ claude plugin marketplace add ${opts.marketplace}\n${m.out.trim()}`);
  // install at user scope, non-interactive
  const i = run(["plugin", "install", opts.ref, "--scope", "user"]);
  log.push(`$ claude plugin install ${opts.ref} --scope user\n${i.out.trim()}`);
  return { error: i.err, log: log.join("\n\n").slice(-3000) };
}

export function uninstallPlugin(ref: string): InstallResult {
  const r = run(["plugin", "uninstall", ref]);
  return { error: r.err, log: r.out.trim().slice(-2000) };
}
