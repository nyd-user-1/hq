import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Drive a real `claude` PTY via tmux to install a Claude Code plugin — the only
// way `/plugin` works (it's a TUI; hq's headless REPL can't run it, the model
// just replies "/plugin isn't available in this environment"). Sequence, VERIFIED
// 2026-06-25 by installing ponytail:
//   /plugin marketplace add <owner/repo>  ↵  → "Successfully added marketplace"
//   /plugin install <plugin@marketplace>  ↵  → a scope menu, default "Install for you"
//   ↵                                         → "✓ Installed"
// We POLL capture-pane for each expected prompt (with timeouts) rather than fixed
// sleeps, so it's robust to claude's startup/network variance.

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
const tmuxBin = () =>
  resolveBin("tmux", ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"]);
const claudeBin = () =>
  process.env.HQ_CLAUDE_BIN ||
  resolveBin("claude", [
    path.join(HOME, ".npm-global/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(HOME, ".local/bin/claude"),
    path.join(HOME, ".bun/bin/claude"),
  ]);

function tmux(...args: string[]): string {
  return execFileSync(tmuxBin(), args, { encoding: "utf8" });
}

export function hasTmux(): boolean {
  try {
    execFileSync(tmuxBin(), ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Poll the pane until any needle appears or we time out; returns the last screen.
async function waitFor(sess: string, needles: string[], timeoutMs: number): Promise<string> {
  const end = Date.now() + timeoutMs;
  let screen = "";
  while (Date.now() < end) {
    try {
      screen = tmux("capture-pane", "-t", sess, "-p");
    } catch {
      screen = "";
    }
    if (needles.some((n) => screen.includes(n))) return screen;
    await sleep(1200);
  }
  return screen;
}

export type InstallResult = { ok: boolean; error?: string; log: string };

export async function installViaTmux(opts: {
  marketplace: string; // owner/repo for `/plugin marketplace add`
  ref: string; // plugin@marketplace for `/plugin install`
  cwd: string;
}): Promise<InstallResult> {
  if (!hasTmux()) return { ok: false, error: "tmux is not installed", log: "" };
  const sess = "hqinstall_" + Math.random().toString(36).slice(2, 8);
  const logs: string[] = [];
  const snap = (label: string, s: string) => logs.push(`# ${label}\n${s.trim()}`);
  const done = (ok: boolean, error?: string): InstallResult => {
    try {
      execFileSync(tmuxBin(), ["kill-session", "-t", sess], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
    return { ok, error, log: logs.join("\n\n").slice(-4000) };
  };

  try {
    tmux("new-session", "-d", "-s", sess, "-x", "200", "-y", "50", "-c", opts.cwd);
    tmux("send-keys", "-t", sess, claudeBin(), "Enter");
    let s = await waitFor(sess, ["Claude Code", "❯"], 45000);
    snap("start", s);
    if (!/Claude Code|❯/.test(s)) return done(false, "claude did not start in the PTY");

    tmux("send-keys", "-t", sess, `/plugin marketplace add ${opts.marketplace}`, "Enter");
    s = await waitFor(sess, ["Successfully added", "already", "Error", "error"], 30000);
    snap("marketplace", s);

    tmux("send-keys", "-t", sess, `/plugin install ${opts.ref}`, "Enter");
    s = await waitFor(
      sess,
      ["Install for you", "Will install", "already installed", "Installed", "Error"],
      30000,
    );
    snap("install-menu", s);

    // If it's not already done, the scope menu is up with "Install for you"
    // pre-selected — one Enter confirms it.
    if (!/Installed/i.test(s)) {
      tmux("send-keys", "-t", sess, "Enter");
      s = await waitFor(sess, ["Installed", "✓", "Error", "error"], 30000);
      snap("confirm", s);
    }

    const ok = /Installed/i.test(s);
    return done(ok, ok ? undefined : "install did not confirm — see log");
  } catch (e) {
    return done(false, e instanceof Error ? e.message : String(e));
  }
}
