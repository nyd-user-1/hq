#!/usr/bin/env node
// Take backstop out of the request path — and nothing else.
//
// Called by the SessionStart preflight when the gateway cannot be revived.
// This is the load-bearing safety property of the whole feature: backstop's
// worst failure mode must be "backstop is gone", never "the account is gone".
// Removing ANTHROPIC_BASE_URL restores the default (api.anthropic.com), so the
// next session born after this runs is a normal, direct session.
//
// Deliberately surgical. It does not touch hooks, the launchd job, or the
// installed files, so `--doctor` can still explain what happened and re-arm.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");
const SETTINGS = path.join(CLAUDE_DIR, "settings.json");
const STATE = path.join(process.env.HQ_BACKSTOP_DIR || path.join(CLAUDE_DIR, "hq"), "backstop.json");
const PORT = Number(process.env.HQ_BACKSTOP_PORT || 3141);
const OURS = `http://127.0.0.1:${PORT}`;
const reason = process.argv.slice(2).join(" ") || "gateway unreachable";

let raw;
try {
  raw = fs.readFileSync(SETTINGS, "utf8");
} catch {
  process.exit(0); // no settings file — nothing routed anywhere
}

let settings;
try {
  settings = JSON.parse(raw);
} catch {
  // NEVER rewrite a file we could not parse. A corrupt settings.json must not
  // be "repaired" into a valid but empty one — that would lose every
  // permission, hook, and preference the user has.
  console.error("settings.json is not valid JSON — left untouched.");
  process.exit(1);
}

// Only ever remove our own value. Someone else's proxy or a different port is
// not ours to delete.
if (settings.env?.ANTHROPIC_BASE_URL !== OURS) process.exit(0);

fs.writeFileSync(`${SETTINGS}.bak-backstop-disarm`, raw);

delete settings.env.ANTHROPIC_BASE_URL;
if (!Object.keys(settings.env).length) delete settings.env;

const tmp = `${SETTINGS}.tmp-${process.pid}`;
fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
fs.renameSync(tmp, SETTINGS);

// Leave a trace for --doctor and for the next session's context. Start from {}
// when there is no state file yet: a gateway that died before it ever wrote one
// is exactly the case where the user most needs to be told why.
try {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    /* no state yet, or unreadable — the trace is still worth writing */
  }
  state.disarmedAt = new Date().toISOString();
  state.disarmReason = reason;
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  const st = `${STATE}.tmp-${process.pid}`;
  fs.writeFileSync(st, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(st, STATE);
} catch {
  /* the trace is a nicety; the disarm above is the point */
}

console.error(`disarmed: ${reason}`);
