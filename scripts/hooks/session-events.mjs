#!/usr/bin/env node
// HQ session-events — a Claude Code SessionStart hook.
//
// WHY: HQ's durable session ledger (~/.claude/hq/events.ndjson) records when each
// session starts/ends and why. SessionEnd can be wired as a native type:"http"
// hook straight to /api/events, but SessionStart does NOT support type:"http"
// (only type:"command" and type:"mcp_tool"), so this tiny command-hook bridges it:
// read the hook JSON from stdin, POST it to HQ's sink best-effort, exit 0 fast.
//
// COST: zero API calls — it just forwards one HTTP POST to localhost. If HQ is
// down the fetch fails silently and the session starts normally.
//
// ── ENABLE (OPT-IN — HQ never writes your settings.json) ──────────────────────
// Add this to ~/.claude/settings.json. SessionStart goes through THIS script;
// SessionEnd points a native http hook straight at the sink:
//
//   {
//     "hooks": {
//       "SessionStart": [
//         {
//           "hooks": [
//             {
//               "type": "command",
//               "command": "node /path/to/hq/scripts/hooks/session-events.mjs"
//             }
//           ]
//         }
//       ],
//       "SessionEnd": [
//         {
//           "hooks": [
//             {
//               "type": "http",
//               "url": "http://localhost:3002/api/events"
//             }
//           ]
//         }
//       ]
//     }
//   }
//
// To disable, remove those two blocks. Nothing else changes — the rest of HQ
// keeps reading the disk.

import process from "node:process";

const ENDPOINT = "http://localhost:3002/api/events";

// Recursion guard — if a downstream probe/agent re-fires SessionStart hooks with
// this env set, short-circuit. (Mirrors usage-capture.mjs's HQ_USAGE_PROBE guard;
// this forwarder is cheap, but staying consistent keeps loops impossible.)
if (process.env.HQ_USAGE_PROBE === "1" || process.env.HQ_EVENTS_FORWARD === "1") {
  process.exit(0);
}

// Read the hook JSON from stdin, forward it verbatim to the sink, exit 0 fast.
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  raw += d;
});
process.stdin.on("end", () => {
  // Validate it's JSON before forwarding; if not, just exit cleanly.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  if (!parsed || typeof parsed !== "object") process.exit(0);

  // Don't block session start. Fire the POST, then exit regardless of the result
  // (swallow every error — HQ may be down). A short timeout caps the wait.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);

  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
    signal: controller.signal,
  })
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer);
      process.exit(0);
    });
});

// If stdin never closes (shouldn't happen for a hook), don't hang forever.
setTimeout(() => process.exit(0), 1500).unref();
