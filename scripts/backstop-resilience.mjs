#!/usr/bin/env node
// Does a broken backstop take the account down?
//
// backstop-selftest.mjs proves the gateway serves traffic correctly. This
// proves the thing that actually bit us: what happens when the gateway is not
// there at all. A reboot dropped the launchd job, ANTHROPIC_BASE_URL kept
// pointing at the dead port, and every session on the account failed with
// ConnectionRefused for two days. No amount of correct in-gateway logic helps,
// because with nothing listening none of it is in the request path.
//
// The invariant under test: BACKSTOP MAY BREAK; THE ACCOUNT MAY NOT.
//
// Runs against a scratch CLAUDE_CONFIG_DIR on its own port and launchd label,
// so it never touches a real account or the real daemon.
//
//   node scripts/backstop-resilience.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER = path.join(HERE, "backstop-install.mjs");
const PORT = 3147;
const LABEL = `com.hq.backstop.${PORT}`;
const PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const CFG = fs.mkdtempSync(path.join(os.tmpdir(), "backstop-resilience-"));
const SETTINGS = path.join(CFG, "settings.json");
const HOOK = path.join(CFG, "hq", "backstop", "backstop-preflight.sh");
const env = { ...process.env, CLAUDE_CONFIG_DIR: CFG, HQ_BACKSTOP_PORT: String(PORT) };

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  console.log(`  ${cond ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${detail ? `  ${dim(detail)}` : ""}`);
  if (cond) passed++;
  else failures.push(label);
};

const sh = (cmd, args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { encoding: "utf8", env, stdio: "pipe", ...opts }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};
const installer = (...args) => sh("node", [INSTALLER, ...args]);
const settings = () => JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
const routed = () => settings().env?.ANTHROPIC_BASE_URL === `http://127.0.0.1:${PORT}`;
const alive = () => sh("curl", ["-sf", "--max-time", "2", `http://127.0.0.1:${PORT}/_backstop/health`]).code === 0;
const runHook = () => sh("bash", [HOOK], { input: "{}" });
const sleep = (s) => sh("sleep", [String(s)]);
const bootout = () => sh("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`]);

// A settings.json with real content — the installer must never flatten it.
fs.writeFileSync(
  SETTINGS,
  JSON.stringify(
    {
      env: { SOMETHING_ELSE: "keep-me" },
      permissions: { allow: ["Bash(ls:*)", "Bash(git status)"] },
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo pre-existing" }] }] },
      theme: "dark",
    },
    null,
    2,
  ),
);

console.log(`\n${b("backstop resilience")}  ${dim(`port ${PORT} · ${CFG}`)}\n`);

try {
  // ---------------------------------------------------------------- install
  console.log(b("1. Install puts the account behind a daemon — carefully"));
  const inst = installer();
  ok("installs cleanly", inst.code === 0, inst.code ? inst.out.trim().split("\n").pop() : "");
  ok("gateway is answering", alive());
  ok("base url is routed at the gateway", routed());
  ok(
    "the plist lives where launchd looks at login",
    fs.existsSync(PLIST),
    "~/Library/LaunchAgents — bootstrap from anywhere else dies at reboot",
  );
  ok(
    "the daemon runs from a snapshot, not the worktree",
    fs.readFileSync(PLIST, "utf8").includes(path.join(CFG, "hq", "backstop", "gateway.mjs")),
    "a checkout or a half-saved edit cannot crash-loop it",
  );
  ok("unrelated settings survive", settings().env.SOMETHING_ELSE === "keep-me" && settings().theme === "dark");
  ok("a pre-existing SessionStart hook is kept", JSON.stringify(settings().hooks).includes("pre-existing"));
  ok("doctor reports healthy", installer("--doctor").code === 0);

  // ------------------------------------------------------------------ crash
  console.log(`\n${b("2. The daemon crashes — launchd brings it back")}`);
  const pid = JSON.parse(sh("curl", ["-s", `http://127.0.0.1:${PORT}/_backstop/health`]).out).pid;
  sh("kill", ["-9", String(pid)]);
  ok("it is really dead", !alive(), `killed pid ${pid}`);
  let back = false;
  for (let i = 0; i < 15 && !back; i++) {
    sleep(1);
    back = alive();
  }
  ok("KeepAlive restarts it unattended", back);

  // ----------------------------------------------------------------- reboot
  console.log(`\n${b("3. A reboot drops the job — THE BUG THAT LOCKED THE ACCOUNT OUT")}`);
  bootout();
  sleep(1);
  ok("gateway is down and the account is pointed at a dead port", !alive() && routed());
  const revived = runHook();
  ok("the SessionStart preflight revives it", alive(), "before the session's first request");
  ok("and lets the session proceed", revived.code === 0, `exit ${revived.code}`);
  ok("the session is told what happened", revived.out.includes("additionalContext"));
  ok("backstop stays in the path — nothing was given up", routed());

  // -------------------------------------------------------- unrecoverable
  console.log(`\n${b("4. The gateway cannot be revived — backstop must yield, not the account")}`);
  bootout();
  fs.rmSync(PLIST);
  sleep(1);
  ok("no gateway, no way to start one", !alive());
  const disarm = runHook();
  ok("the preflight disarms backstop", !routed(), "ANTHROPIC_BASE_URL removed");
  ok("so the NEXT session goes straight to the API", settings().env?.ANTHROPIC_BASE_URL === undefined);
  ok("exit 2 — stderr reaches the user in the transcript", disarm.code === 2);
  // Not just "some text appeared": the message has to name a command that
  // exists on THIS machine. The installer stamps its own invocation next to the
  // runtime precisely so an npx install is never told to run a repo path.
  const stamped = fs.readFileSync(path.join(CFG, "hq", "backstop", "how"), "utf8").trim();
  ok(
    "and it says how to recover, in a command that exists here",
    disarm.out.includes(`${stamped} eject`) && disarm.out.includes("new terminal window"),
    stamped,
  );
  ok("everything else in settings.json is intact", settings().env.SOMETHING_ELSE === "keep-me" && settings().permissions.allow.length === 2 && settings().theme === "dark");
  const state = JSON.parse(fs.readFileSync(path.join(CFG, "hq", "backstop.json"), "utf8"));
  ok("the reason is recorded for later", !!state.disarmedAt && !!state.disarmReason, state.disarmReason);
  ok("doctor explains the disarm instead of erroring", installer("--doctor").out.includes("disarmed itself"));
  ok("a disarmed machine stops nagging", runHook().code === 0, "second run is silent");

  // -------------------------------------------------------- corrupt settings
  console.log(`\n${b("5. A settings.json we cannot parse is one we must not write")}`);
  const good = fs.readFileSync(SETTINGS, "utf8");
  fs.writeFileSync(SETTINGS, "{ this is not json");
  const refused = installer();
  ok("install refuses rather than flattening it", refused.code === 1 && refused.out.includes("not valid JSON"));
  ok("the file is left exactly as it was", fs.readFileSync(SETTINGS, "utf8") === "{ this is not json");
  fs.writeFileSync(SETTINGS, good);

  // ------------------------------------------------------- the prompt hook
  //
  // /backstop must never reach the model. It is a local command, it is free,
  // and at the wall the model is the one thing that cannot answer — a prompt
  // that slips through is a billed turn at the exact moment the user has no
  // budget. The hook stops it on stdout JSON (exit 0) for a clean render, which
  // means a stdout that fails to parse is handed to the model as context. So
  // the contract is: whatever happens, the prompt does not go through.
  console.log(`\n${b("6. /backstop never reaches the model")}`);
  installer(); // re-arm so the control script and gateway exist
  // envOverride REPLACES the environment (sh spreads opts over its base), which
  // is exactly what the no-node case wants and exactly what the others must not
  // have — an empty env would leave bash without a PATH.
  const promptHook = (prompt, envOverride) =>
    sh("bash", [path.join(CFG, "hq", "backstop", "backstop-hook.sh")], {
      input: JSON.stringify({ prompt }),
      ...(envOverride ? { env: envOverride } : {}),
    });

  const status = promptHook("/backstop status");
  ok("it is stopped, and not as an error", status.code === 0, "exit 0 + JSON, not exit 2 + stderr");
  let parsed = null;
  try {
    parsed = JSON.parse(status.out);
  } catch {
    /* stays null — which is the failure this whole section exists to catch */
  }
  ok("stdout is JSON, so it is never handed to the model as context", !!parsed);
  ok("the turn is stopped", parsed?.continue === false);
  ok("the user is told, in text Claude never sees", typeof parsed?.stopReason === "string" && parsed.stopReason.includes("backstop"));
  ok("no raw escape bytes — those make the JSON unparseable", !/\x1b/.test(status.out));

  // The fallback. Strip node and the JSON path cannot run; the hook must still
  // block, just less prettily.
  const noNode = promptHook("/backstop status", { PATH: "/usr/bin:/bin" });
  ok("with no node, it falls back to exit 2 rather than letting the prompt fly", noNode.code === 2);

  ok("an ordinary prompt about backstop is untouched", promptHook("what does backstop do?").code === 0);
  ok("...and adds nothing to the conversation", promptHook("what does backstop do?").out.trim() === "");

  // ------------------------------------------------------------------ eject
  console.log(`\n${b("7. Eject leaves no trace")}`);
  installer(); // re-arm so there is something to remove
  ok("re-arms cleanly", alive() && routed());
  const ejected = installer("--eject");
  ok("ejects", ejected.code === 0);
  ok("the launchd job is unloaded", sh("launchctl", ["print", `gui/${process.getuid()}/${LABEL}`]).code !== 0);
  ok("the plist is gone", !fs.existsSync(PLIST));
  ok("the runtime snapshot is gone", !fs.existsSync(path.join(CFG, "hq", "backstop")));
  ok("sessions go direct again", !routed());
  ok("the user's own hook survived it all", JSON.stringify(settings().hooks).includes("pre-existing"));
  ok("and so did their settings", settings().env.SOMETHING_ELSE === "keep-me" && settings().permissions.allow.length === 2);
} finally {
  bootout();
  if (fs.existsSync(PLIST)) fs.rmSync(PLIST);
  fs.rmSync(CFG, { recursive: true, force: true });
}

console.log(
  failures.length
    ? `\n\x1b[1;31mFAILED\x1b[0m  ${passed} passed, ${failures.length} failed\n  ${failures.join("\n  ")}\n`
    : `\n\x1b[1;32mALL GREEN\x1b[0m  ${passed} passed, 0 failed\n`,
);
process.exit(failures.length ? 1 : 0);
