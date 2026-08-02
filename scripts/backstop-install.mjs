#!/usr/bin/env node
// Install (or remove) backstop on this machine.
//
//   node scripts/backstop-install.mjs           install + start
//   node scripts/backstop-install.mjs --eject    remove everything, restore direct API
//   node scripts/backstop-install.mjs --status   report what is installed
//
// Four pieces:
//   1. ANTHROPIC_BASE_URL in ~/.claude/settings.json  — puts the gateway in the
//      request path at session birth, which is the only way an in-place flip
//      can work later.
//   2. ~/.claude/commands/backstop.md                 — so /backstop exists in
//      the TUI (an unknown slash command never reaches a hook).
//   3. A UserPromptSubmit hook                        — does the actual work
//      client-side, so it still works when the API is refusing.
//   4. A launchd LaunchAgent                          — keeps the gateway up.
//      Gateway down would mean sessions down, so KeepAlive is not optional.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE_DIR = path.join(HOME, ".claude");
const HQ_DIR = path.join(CLAUDE_DIR, "hq");
const SETTINGS = path.join(CLAUDE_DIR, "settings.json");
const COMMANDS_DIR = path.join(CLAUDE_DIR, "commands");
const COMMAND_FILE = path.join(COMMANDS_DIR, "backstop.md");
const CTL = path.join(HQ_DIR, "backstop-ctl.sh");
const HOOK = path.join(HQ_DIR, "backstop-hook.sh");
const PLIST = path.join(HQ_DIR, "com.hq.backstop.plist");
const LABEL = "com.hq.backstop";
const PORT = Number(process.env.HQ_BACKSTOP_PORT || 3141);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const mode = process.argv.includes("--eject")
  ? "eject"
  : process.argv.includes("--status")
    ? "status"
    : "install";

const say = (s) => console.log(s);
const uid = process.getuid();

const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
};

const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, p);
};

const COMMAND_BODY = `---
description: Unfreeze every open session on hq backstop capacity when you hit your usage limit. \`/backstop off\` releases it.
argument-hint: [off|status]
---

Reply with exactly one line: "backstop is handled locally — nothing to do."

$ARGUMENTS
`;

// The command file exists so the TUI recognises /backstop and offers it in the
// completion menu. It should never actually reach the model: the hook blocks
// the prompt first. The body above is a harmless fallback for the case where
// hooks are disabled.

const PLIST_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(REPO, "lib", "backstop", "gateway.mjs")}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>HQ_BACKSTOP_PORT</key><string>${PORT}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(HQ_DIR, "backstop.out.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(HQ_DIR, "backstop.err.log")}</string>
</dict>
</plist>
`;

function ensureHook(settings) {
  settings.hooks ??= {};
  const list = (settings.hooks.UserPromptSubmit ??= []);
  const already = JSON.stringify(list).includes("backstop-hook.sh");
  if (!already) list.push({ hooks: [{ type: "command", command: HOOK }] });
  return !already;
}

function removeHook(settings) {
  const list = settings.hooks?.UserPromptSubmit;
  if (!Array.isArray(list)) return false;
  const kept = list.filter((entry) => !JSON.stringify(entry).includes("backstop-hook.sh"));
  if (kept.length === list.length) return false;
  if (kept.length) settings.hooks.UserPromptSubmit = kept;
  else delete settings.hooks.UserPromptSubmit;
  return true;
}

const launchctl = (args, quiet = true) => {
  try {
    execFileSync("launchctl", args, { stdio: quiet ? "ignore" : "inherit" });
    return true;
  } catch {
    return false;
  }
};

// ------------------------------------------------------------------- status

if (mode === "status") {
  const settings = readJson(SETTINGS, {});
  const baseUrl = settings.env?.ANTHROPIC_BASE_URL;
  say("\nbackstop install status\n");
  say(`  base url routed here   ${baseUrl === BASE_URL ? `yes  (${baseUrl})` : `NO   (${baseUrl ?? "unset — sessions go direct"})`}`);
  say(`  /backstop command      ${fs.existsSync(COMMAND_FILE) ? "yes" : "NO"}`);
  say(`  prompt hook            ${JSON.stringify(settings.hooks ?? {}).includes("backstop-hook.sh") ? "yes" : "NO"}`);
  say(`  control script         ${fs.existsSync(CTL) ? "yes" : "NO"}`);
  say(`  launchd agent          ${fs.existsSync(PLIST) ? "yes" : "NO"}`);
  try {
    const r = execFileSync("curl", ["-s", "--max-time", "3", `${BASE_URL}/_backstop/status`], { encoding: "utf8" });
    const s = JSON.parse(r);
    say(`  gateway                running (pid ${s.pid}, mode=${s.mode}, provider=${s.provider})`);
  } catch {
    say("  gateway                NOT RUNNING");
  }
  say("");
  process.exit(0);
}

// -------------------------------------------------------------------- eject

if (mode === "eject") {
  say("\nRemoving backstop…\n");
  launchctl(["bootout", `gui/${uid}/${LABEL}`]);
  say("  · launchd agent unloaded");

  const settings = readJson(SETTINGS, {});
  if (settings.env?.ANTHROPIC_BASE_URL === BASE_URL) {
    delete settings.env.ANTHROPIC_BASE_URL;
    if (!Object.keys(settings.env).length) delete settings.env;
    say("  · ANTHROPIC_BASE_URL removed — new sessions go direct to the API again");
  }
  if (removeHook(settings)) say("  · prompt hook removed");
  writeJson(SETTINGS, settings);

  for (const f of [COMMAND_FILE, PLIST, CTL, HOOK]) {
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      say(`  · removed ${f.replace(HOME, "~")}`);
    }
  }
  say("\nBackstop removed. Open sessions keep their old setting until restarted.\n");
  process.exit(0);
}

// ------------------------------------------------------------------ install

say("\nInstalling backstop…\n");
fs.mkdirSync(HQ_DIR, { recursive: true });
fs.mkdirSync(COMMANDS_DIR, { recursive: true });

for (const [src, dest] of [
  [path.join(REPO, "lib", "backstop", "backstop-ctl.sh"), CTL],
  [path.join(REPO, "lib", "backstop", "backstop-hook.sh"), HOOK],
]) {
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  say(`  · ${path.basename(dest)} installed`);
}

fs.writeFileSync(COMMAND_FILE, COMMAND_BODY);
say("  · /backstop command registered");

const settings = readJson(SETTINGS, {});
settings.env ??= {};
const prevBaseUrl = settings.env.ANTHROPIC_BASE_URL;
if (prevBaseUrl && prevBaseUrl !== BASE_URL) {
  say(`  ! ANTHROPIC_BASE_URL was already set to ${prevBaseUrl} — leaving it alone.`);
  say("    Backstop cannot route this machine's sessions until that is resolved.");
} else {
  settings.env.ANTHROPIC_BASE_URL = BASE_URL;
  say(`  · ANTHROPIC_BASE_URL -> ${BASE_URL}`);
}
if (ensureHook(settings)) say("  · UserPromptSubmit hook registered");
writeJson(SETTINGS, settings);

fs.writeFileSync(PLIST, PLIST_BODY);
launchctl(["bootout", `gui/${uid}/${LABEL}`]);
const booted = launchctl(["bootstrap", `gui/${uid}`, PLIST]);
launchctl(["kickstart", "-k", `gui/${uid}/${LABEL}`]);
say(`  · launchd agent ${booted ? "loaded" : "reloaded"} (KeepAlive on)`);

// Confirm it answers before claiming success.
let up = false;
for (let i = 0; i < 25 && !up; i++) {
  try {
    execFileSync("curl", ["-sf", "--max-time", "2", `${BASE_URL}/_backstop/health`], { stdio: "ignore" });
    up = true;
  } catch {
    execFileSync("sleep", ["0.2"]);
  }
}

say("");
if (up) {
  say(`Backstop is live on ${BASE_URL}.`);
  say("Sessions started from now on route through it. At the wall, type /backstop.\n");
} else {
  say("Installed, but the gateway did not answer. Check ~/.claude/hq/backstop.err.log\n");
  process.exit(1);
}
