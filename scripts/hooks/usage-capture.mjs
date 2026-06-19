#!/usr/bin/env node
// HQ usage-capture — a Claude Code SessionStart hook.
//
// WHY: the real /usage rate-limit windows (5h session, 7d all-models, 7d Opus)
// are parsed from API response headers in-process and NEVER written to disk —
// not to the transcript, not to a cache. So HQ (a disk reader) can't see them.
// This hook is the bridge: at session start it (1) injects the last known usage
// into THIS session's context — so it's memorialized in the transcript — and
// (2) fires one cheap headless probe to refresh ~/.claude/hq/usage-snapshot.json,
// which HQ's API panel reads as the "live" overlay.
//
// COST: one Haiku turn per refresh, in an empty temp dir with MCP disabled (so
// no project context / no tool-def bloat) → a fraction of a cent. Gated so it
// only refreshes when the snapshot is stale (default 10 min), and HARD-guarded
// against recursion (the probe is itself a claude session that re-fires this
// hook — the HQ_USAGE_PROBE env var short-circuits that).
//
// ENABLE: add to ~/.claude/settings.json (the first probe is a paid call):
//   "hooks": { "SessionStart": [ { "hooks": [
//     { "type": "command",
//       "command": "node /Users/brendanstanton/code/hq/scripts/hooks/usage-capture.mjs" } ] } ] }
//
// DEBUG: every probe dumps its raw stream to ~/.claude/hq/usage-probe-debug.jsonl
// so the parser can be checked/tuned against what the CLI actually emits.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const HQ_DIR = path.join(os.homedir(), ".claude", "hq");
const SNAP = path.join(HQ_DIR, "usage-snapshot.json");
const DEBUG = path.join(HQ_DIR, "usage-probe-debug.jsonl");
const SENTINEL = "hq-usage-probe"; // must match USAGE_PROBE_SENTINEL in lib/calls.ts
const FRESH_MS = 10 * 60 * 1000; // skip the refresh if the snapshot is younger than this
const PROBE_MODEL = "claude-haiku-4-5-20251001";

const readSnap = () => {
  try {
    return JSON.parse(fs.readFileSync(SNAP, "utf8"));
  } catch {
    return null;
  }
};

// ── --probe: the detached refresher (runs claude, writes the snapshot) ────────
async function runProbe() {
  fs.mkdirSync(HQ_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hq-usage-"));
  const child = spawn(
    "claude",
    [
      "-p",
      `${SENTINEL}: reply with the single word ok`,
      "--model",
      PROBE_MODEL,
      "--output-format",
      "stream-json",
      "--verbose",
      // no MCP / no project context → the probe stays a tiny, cheap turn
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
    ],
    { cwd: tmp, env: { ...process.env, HQ_USAGE_PROBE: "1" } }
  );

  const windows = {};
  const dbg = [];
  let buf = "";

  // Pull rate-limit data out of whatever shape the stream emits: the
  // rate_limit_event ({rateLimitType, utilization, resetsAt, status}) and/or an
  // all-windows object (five_hour/seven_day/... each {utilization, resets_at}).
  const harvest = (e) => {
    if (e && e.type === "rate_limit_event" && e.rate_limit_info) {
      const r = e.rate_limit_info;
      if (r.rateLimitType)
        windows[r.rateLimitType] = {
          utilization: r.utilization,
          resetsAt: r.resetsAt,
          status: r.status,
        };
    }
    // deep-scan for an all-windows object anywhere in the event
    const scan = (o, depth) => {
      if (!o || typeof o !== "object" || depth > 6) return;
      for (const k of ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet", "overage"]) {
        const w = o[k];
        if (w && typeof w === "object" && (w.utilization != null || w.resets_at != null || w.resetsAt != null)) {
          windows[k] = {
            utilization: w.utilization,
            resetsAt: w.resetsAt ?? w.resets_at,
            status: w.status,
          };
        }
      }
      for (const v of Object.values(o)) if (v && typeof v === "object") scan(v, depth + 1);
    };
    scan(e, 0);
  };

  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      dbg.push(line);
      try {
        harvest(JSON.parse(line));
      } catch {
        /* non-JSON line — skip */
      }
    }
  });

  child.on("close", () => {
    try {
      fs.writeFileSync(DEBUG, dbg.slice(-200).join("\n"));
    } catch {
      /* best-effort debug */
    }
    if (Object.keys(windows).length) {
      fs.writeFileSync(
        SNAP,
        JSON.stringify({ capturedAt: Date.now(), source: "hook-probe", windows }, null, 2)
      );
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* leave the temp dir if cleanup fails */
    }
  });
}

// ── default: the SessionStart hook entry ──────────────────────────────────────
function runHook() {
  // Recursion guard — the probe's own claude session re-fires this hook.
  if (process.env.HQ_USAGE_PROBE === "1") process.exit(0);

  const snap = readSnap();

  // (1) Memorialize the last known usage in THIS session's transcript.
  if (snap && snap.windows) {
    const lines = Object.entries(snap.windows)
      .map(([k, w]) => {
        const pct = typeof w.utilization === "number" ? `${Math.round(w.utilization * 100)}% used` : "?";
        const reset = w.resetsAt ? `, resets ${new Date(w.resetsAt).toLocaleString()}` : "";
        return `  - ${k}: ${pct}${reset}`;
      })
      .join("\n");
    const ctx = `Claude usage at session start (captured ${new Date(snap.capturedAt).toLocaleString()}):\n${lines}`;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx },
      })
    );
  }

  // (2) Refresh the snapshot for next time — only if stale, fully detached so it
  // never blocks session start.
  const stale = !snap || Date.now() - snap.capturedAt > FRESH_MS;
  if (stale) {
    const ref = spawn(process.execPath, [process.argv[1], "--probe"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, HQ_USAGE_PROBE: "1" },
    });
    ref.unref();
  }
  process.exit(0);
}

if (process.argv.includes("--probe")) runProbe();
else runHook();
