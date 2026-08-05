#!/usr/bin/env node
// Install (or remove) backstop on this machine.
//
//   node scripts/backstop-install.mjs           install + start
//   node scripts/backstop-install.mjs --eject    remove everything, restore direct API
//   node scripts/backstop-install.mjs --status   report what is installed
//   node scripts/backstop-install.mjs --doctor   check every invariant that,
//                                                if broken, takes the account down
//
// Five pieces:
//   1. ANTHROPIC_BASE_URL in ~/.claude/settings.json  — puts the gateway in the
//      request path at session birth, which is the only way an in-place flip
//      can work later.
//   2. ~/.claude/commands/backstop.md                 — so /backstop exists in
//      the TUI (an unknown slash command never reaches a hook).
//   3. A UserPromptSubmit hook                        — does the actual work
//      client-side, so it still works when the API is refusing.
//   4. A launchd LaunchAgent in ~/Library/LaunchAgents — keeps the gateway up.
//   5. A SessionStart preflight hook                  — revives a dead gateway,
//      or disarms backstop if it cannot. The floor under (1).
//
// Piece 1 makes the account depend on a local daemon, so pieces 4 and 5 are
// what keep that dependency honest. Three rules earned the hard way:
//
//   · The plist MUST live in ~/Library/LaunchAgents. `launchctl bootstrap`
//     from any other path lasts only until logout — a reboot silently drops
//     the job, KeepAlive included, and every session then dials a dead port.
//   · The daemon MUST run from a snapshot under ~/.claude/hq/backstop, never
//     from the git worktree. Pointing launchd at the repo means a checkout,
//     a rename, or a half-saved edit crash-loops the gateway and takes every
//     session on the machine with it.
//   · A gateway that cannot be revived MUST disarm itself. No code of ours is
//     in the request path when the port is dead, so nothing else can save it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Follow CLAUDE_CONFIG_DIR so a second account can be used as a proving ground.
// Without this, "testing on the other account" silently rewrites the primary
// account's settings.json — which is how a test took the main account down.
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const HQ_DIR = path.join(CLAUDE_DIR, "hq");
const RUNTIME_DIR = path.join(HQ_DIR, "backstop");
const SETTINGS = path.join(CLAUDE_DIR, "settings.json");
const COMMANDS_DIR = path.join(CLAUDE_DIR, "commands");
const COMMAND_FILE = path.join(COMMANDS_DIR, "backstop.md");
// /reload-N needs its own command file for the same reason /backstop does: the
// TUI rejects an unknown slash command before any hook can see it.
const RELOAD_FILES = [5, 10, 20].map((n) => [n, path.join(COMMANDS_DIR, `reload-${n}.md`)]);
const CTL = path.join(RUNTIME_DIR, "backstop-ctl.sh");
const HOOK = path.join(RUNTIME_DIR, "backstop-hook.sh");
const PREFLIGHT = path.join(RUNTIME_DIR, "backstop-preflight.sh");
const GATEWAY = path.join(RUNTIME_DIR, "gateway.mjs");
const STAMP = path.join(RUNTIME_DIR, "installed.json");
const LAUNCH_AGENTS = path.join(HOME, "Library", "LaunchAgents");
const PORT = Number(process.env.HQ_BACKSTOP_PORT || 3141);
// One daemon per port. A test install on another port gets its own label and
// its own plist, so it can never bootout or overwrite the real one.
const LABEL = PORT === 3141 ? "com.hq.backstop" : `com.hq.backstop.${PORT}`;
const PLIST = path.join(LAUNCH_AGENTS, `${LABEL}.plist`);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Everything the daemon needs at runtime, snapshotted away from the worktree.
const RUNTIME_FILES = [
  "gateway.mjs",
  "billing.mjs",
  "state.mjs",
  "upstreams.mjs",
  "sigv4.mjs",
  "eventstream.mjs",
  "disarm.mjs",
];
const SHELL_FILES = ["backstop-ctl.sh", "backstop-hook.sh", "backstop-preflight.sh"];

// Paths used by installs before the snapshot/LaunchAgents move. Eject has to
// clear these too or an upgrade leaves a second, stale gateway definition.
const LEGACY = [
  path.join(HQ_DIR, "com.hq.backstop.plist"),
  path.join(HQ_DIR, "backstop-ctl.sh"),
  path.join(HQ_DIR, "backstop-hook.sh"),
];

const mode = process.argv.includes("--eject")
  ? "eject"
  : process.argv.includes("--doctor")
    ? "doctor"
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

// settings.json gets a stricter reader than everything else: a parse failure
// here used to fall back to {}, and the very next writeJson would replace every
// permission, hook, and preference the user had with an empty object. A file we
// cannot read is a file we must not write.
const readSettings = () => {
  let raw;
  try {
    raw = fs.readFileSync(SETTINGS, "utf8");
  } catch {
    return {}; // genuinely absent — a fresh install may create it
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    say(`\n  ✗ ${SETTINGS} is not valid JSON (${e.message}).`);
    say("    Refusing to touch it — fix the file first, nothing was changed.\n");
    process.exit(1);
  }
};

const sha256 = (p) => {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch {
    return null;
  }
};

const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, p);
};

const COMMAND_BODY = `---
description: Unfreeze every open session on hq backstop capacity when you hit your usage limit. Run it again to release.
argument-hint: [off|status|force]
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
    <string>${GATEWAY}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HQ_BACKSTOP_PORT</key><string>${PORT}</string>
    <key>HQ_BACKSTOP_DIR</key><string>${HQ_DIR}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${path.join(HQ_DIR, "backstop.out.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(HQ_DIR, "backstop.err.log")}</string>
</dict>
</plist>
`;

// Hooks are matched by script BASENAME, not full path, so an install that moves
// a script (hq/foo.sh -> hq/backstop/foo.sh) replaces its entry instead of
// leaving a second one pointing at a file that eject just deleted.
function ensureHook(settings, event, script) {
  settings.hooks ??= {};
  const list = (settings.hooks[event] ??= []);
  const base = path.basename(script);
  const kept = list.filter((entry) => !JSON.stringify(entry).includes(base));
  const changed = kept.length !== list.length;
  kept.push({ hooks: [{ type: "command", command: script }] });
  settings.hooks[event] = kept;
  return !changed; // true = genuinely new, false = re-pointed an existing entry
}

function removeHook(settings, event, basename) {
  const list = settings.hooks?.[event];
  if (!Array.isArray(list)) return false;
  const kept = list.filter((entry) => !JSON.stringify(entry).includes(basename));
  if (kept.length === list.length) return false;
  if (kept.length) settings.hooks[event] = kept;
  else delete settings.hooks[event];
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

const gatewayStatus = () => {
  try {
    return JSON.parse(
      execFileSync("curl", ["-s", "--max-time", "3", `${BASE_URL}/_backstop/status`], { encoding: "utf8" }),
    );
  } catch {
    return null;
  }
};

const jobLoaded = () => launchctl(["print", `gui/${uid}/${LABEL}`]);

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
  const s = gatewayStatus();
  say(`  gateway                ${s ? `running (pid ${s.pid}, mode=${s.mode}, provider=${s.provider})` : "NOT RUNNING"}`);
  say("");
  process.exit(0);
}

// ------------------------------------------------------------------- doctor
// Every check here is an invariant whose failure makes sessions on this machine
// stop working. Anything that reports BROKEN means the account is at risk right
// now, so doctor exits non-zero and names the one command that fixes it.

if (mode === "doctor") {
  const settings = readJson(SETTINGS, {});
  const baseUrl = settings.env?.ANTHROPIC_BASE_URL;
  const routed = baseUrl === BASE_URL;
  const hooks = JSON.stringify(settings.hooks ?? {});
  const state = readJson(path.join(HQ_DIR, "backstop.json"), {});
  const problems = [];

  const check = (label, ok, detail, fatal = true) => {
    say(`  ${ok ? "ok   " : fatal ? "BROKEN" : "warn "} ${label.padEnd(24)} ${detail}`);
    if (!ok && fatal) problems.push(label);
  };

  say("\nbackstop doctor\n");

  if (!routed) {
    say(`  Backstop is not in the request path (ANTHROPIC_BASE_URL ${baseUrl ? `= ${baseUrl}` : "unset"}).`);
    say("  Sessions go straight to the API — nothing here can break them.\n");
    if (state.disarmedAt) {
      say(`  It disarmed itself at ${state.disarmedAt}`);
      say(`  because: ${state.disarmReason}\n`);
      say("  Re-arm with: node scripts/backstop-install.mjs\n");
    }
    process.exit(0);
  }

  // The reboot bug: bootstrap from any path outside ~/Library/LaunchAgents is
  // forgotten at logout, so the job never comes back and the port stays dead.
  check("plist in LaunchAgents", fs.existsSync(PLIST), fs.existsSync(PLIST) ? PLIST.replace(HOME, "~") : "MISSING — the job will not survive a reboot");
  check("launchd job loaded", jobLoaded(), jobLoaded() ? LABEL : `not registered — run: launchctl bootstrap gui/${uid} ${PLIST.replace(HOME, "~")}`);

  // The worktree bug: launchd pointed at the repo means a checkout or a
  // half-saved edit crash-loops the daemon and takes every session with it.
  const snapshot = fs.existsSync(GATEWAY);
  check("runtime snapshot", snapshot, snapshot ? RUNTIME_DIR.replace(HOME, "~") : "MISSING — reinstall");
  if (snapshot) {
    const plistBody = fs.readFileSync(PLIST, "utf8");
    check("daemon runs from snapshot", plistBody.includes(GATEWAY), plistBody.includes(REPO + "/lib") ? `points at the git worktree (${REPO}) — a checkout can take the account down` : "not the repo");
    const drifted = RUNTIME_FILES.filter(
      (f) => sha256(path.join(RUNTIME_DIR, f)) !== sha256(path.join(REPO, "lib", "backstop", f)),
    );
    check("snapshot up to date", drifted.length === 0, drifted.length ? `${drifted.join(", ")} differ from the repo — reinstall to pick up fixes` : "matches the repo", false);
  }

  check("preflight hook", hooks.includes("backstop-preflight.sh"), hooks.includes("backstop-preflight.sh") ? "SessionStart" : "MISSING — a dead gateway cannot disarm itself");
  check("prompt hook", hooks.includes("backstop-hook.sh"), hooks.includes("backstop-hook.sh") ? "UserPromptSubmit" : "MISSING — /backstop will not respond", false);
  check("/backstop command", fs.existsSync(COMMAND_FILE), fs.existsSync(COMMAND_FILE) ? COMMAND_FILE.replace(HOME, "~") : "MISSING", false);

  const s = gatewayStatus();
  check("gateway answering", !!s, s ? `pid ${s.pid}, mode=${s.mode}, provider=${s.provider}` : `nothing on ${BASE_URL} — EVERY session on this account is failing right now`);

  if (state.disarmedAt) say(`\n  note: backstop disarmed itself at ${state.disarmedAt} (${state.disarmReason}) and has since been re-armed.`);

  if (problems.length) {
    say(`\n  ${problems.length} broken invariant${problems.length > 1 ? "s" : ""}. Repair:  node scripts/backstop-install.mjs`);
    say("  Or take backstop out of the path entirely:  node scripts/backstop-install.mjs --eject\n");
    process.exit(1);
  }
  say("\n  Healthy. A reboot, a crash, and a bad checkout are all survivable.\n");
  process.exit(0);
}

// -------------------------------------------------------------------- eject

if (mode === "eject") {
  say("\nRemoving backstop…\n");
  launchctl(["bootout", `gui/${uid}/${LABEL}`]);
  say("  · launchd agent unloaded");

  const settings = readSettings();
  if (settings.env?.ANTHROPIC_BASE_URL === BASE_URL) {
    delete settings.env.ANTHROPIC_BASE_URL;
    if (!Object.keys(settings.env).length) delete settings.env;
    say("  · ANTHROPIC_BASE_URL removed — new sessions go direct to the API again");
  }
  if (removeHook(settings, "UserPromptSubmit", "backstop-hook.sh")) say("  · prompt hook removed");
  if (removeHook(settings, "SessionStart", "backstop-preflight.sh")) say("  · preflight hook removed");
  writeJson(SETTINGS, settings);

  for (const f of [COMMAND_FILE, ...RELOAD_FILES.map(([, f]) => f), PLIST, ...LEGACY]) {
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      say(`  · removed ${f.replace(HOME, "~")}`);
    }
  }
  if (fs.existsSync(RUNTIME_DIR)) {
    fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
    say(`  · removed ${RUNTIME_DIR.replace(HOME, "~")}`);
  }
  say("\nBackstop removed. Open sessions keep their old setting until restarted —");
  say("open a NEW terminal window to get a session that goes direct to the API.\n");
  process.exit(0);
}

// ------------------------------------------------------------------ install

say("\nInstalling backstop…\n");
fs.mkdirSync(RUNTIME_DIR, { recursive: true });
fs.mkdirSync(COMMANDS_DIR, { recursive: true });
fs.mkdirSync(LAUNCH_AGENTS, { recursive: true });

// Snapshot the runtime out of the git worktree. From here the daemon has no
// dependency on the repo's current state, so editing lib/backstop — or checking
// out a branch that predates it — can no longer take a live account down. The
// price is that fixes need a reinstall to land; --doctor reports the drift.
for (const f of RUNTIME_FILES) {
  fs.copyFileSync(path.join(REPO, "lib", "backstop", f), path.join(RUNTIME_DIR, f));
}
say(`  · runtime snapshotted to ${RUNTIME_DIR.replace(HOME, "~")} (${RUNTIME_FILES.length} files)`);

for (const f of SHELL_FILES) {
  const dest = path.join(RUNTIME_DIR, f);
  fs.copyFileSync(path.join(REPO, "lib", "backstop", f), dest);
  fs.chmodSync(dest, 0o755);
  say(`  · ${f} installed`);
}

// The daemon runs under launchd with a bare environment — no shell, no
// .env.local on its path. Snapshot the key next to the runtime for the same
// reason the code is snapshotted: it must not depend on the worktree.
const stripeKey = (() => {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  try {
    return fs.readFileSync(path.join(REPO, ".env.local"), "utf8").match(/^STRIPE_SECRET_KEY\s*=\s*["']?([^"'\s]+)/m)?.[1];
  } catch {
    return null;
  }
})();
if (stripeKey) {
  const kp = path.join(RUNTIME_DIR, "stripe.key");
  fs.writeFileSync(kp, `STRIPE_SECRET_KEY=${stripeKey}\n`, { mode: 0o600 });
  say(`  · stripe key snapshotted (${stripeKey.slice(0, 8)}…)`);
} else {
  say("  ! no STRIPE_SECRET_KEY found — /backstop can engage but cannot sell a pass");
}

fs.writeFileSync(path.join(RUNTIME_DIR, "port"), `${PORT}\n`);

fs.writeFileSync(
  STAMP,
  `${JSON.stringify({ installedAt: new Date().toISOString(), fromRepo: REPO, port: PORT }, null, 2)}\n`,
);

fs.writeFileSync(COMMAND_FILE, COMMAND_BODY);
for (const [n, f] of RELOAD_FILES) {
  fs.writeFileSync(
    f,
    `---\ndescription: Add $${n} of backstop capacity without leaving the terminal.\n---\n\nReply with exactly one line: "backstop is handled locally — nothing to do."\n`,
  );
}
say("  · /backstop + /reload-5|10|20 commands registered");

const settings = readSettings();
settings.env ??= {};
const prevBaseUrl = settings.env.ANTHROPIC_BASE_URL;
if (prevBaseUrl && prevBaseUrl !== BASE_URL) {
  say(`  ! ANTHROPIC_BASE_URL was already set to ${prevBaseUrl} — leaving it alone.`);
  say("    Backstop cannot route this machine's sessions until that is resolved.");
} else {
  settings.env.ANTHROPIC_BASE_URL = BASE_URL;
  say(`  · ANTHROPIC_BASE_URL -> ${BASE_URL}`);
}
// The preflight goes in FIRST so that if anything below fails, the machine
// already has the escape hatch that disarms a dead gateway.
ensureHook(settings, "SessionStart", PREFLIGHT);
say("  · SessionStart preflight hook registered");
ensureHook(settings, "UserPromptSubmit", HOOK);
say("  · UserPromptSubmit hook registered");
writeJson(SETTINGS, settings);

fs.writeFileSync(PLIST, PLIST_BODY);
say(`  · plist written to ${PLIST.replace(HOME, "~")} (survives reboot)`);

// bootout is asynchronous: bootstrapping too soon fails with EIO and leaves the
// agent unloaded entirely — which on a reinstall means no gateway at all, and
// every session's base url pointing at a dead port. Wait for the old job to
// actually go away, then retry.
launchctl(["bootout", `gui/${uid}/${LABEL}`]);
let booted = false;
for (let i = 0; i < 25 && !booted; i++) {
  booted = launchctl(["bootstrap", `gui/${uid}`, PLIST]);
  if (!booted) execFileSync("sleep", ["0.2"]);
}
launchctl(["kickstart", "-k", `gui/${uid}/${LABEL}`]);
say(`  · launchd agent ${booted ? "loaded" : "NOT LOADED — run: launchctl bootstrap gui/" + uid + " " + PLIST}`);

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
  say("Sessions started from now on route through it. At the wall, type /backstop.");
  say("Check it any time with:  node scripts/backstop-install.mjs --doctor\n");
} else {
  // Never leave the machine routed at a port that did not come up. The whole
  // point of the rebuild is that this state cannot outlive the installer.
  say("The gateway did not answer — backing the base url out rather than leaving");
  say("every session pointed at a dead port.\n");
  const s = readSettings();
  if (s.env?.ANTHROPIC_BASE_URL === BASE_URL) {
    delete s.env.ANTHROPIC_BASE_URL;
    if (!Object.keys(s.env).length) delete s.env;
    writeJson(SETTINGS, s);
    say("  · ANTHROPIC_BASE_URL removed — sessions go direct to the API");
  }
  say("\nCheck ~/.claude/hq/backstop.err.log, then reinstall.\n");
  process.exit(1);
}
