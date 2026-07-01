import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The hq dev server (:3002) as a launchd agent under EXPLICIT control. The plist
// deliberately lives OUTSIDE ~/Library/LaunchAgents so login never auto-loads it
// (no always-on RAM burn); this module is the programmatic on/off switch behind
// /api/hq-dev — the same contract the /hq-dev skill drives from the CLI. Distinct
// from lib/dev-server.ts (the Preview panel's per-project managed servers).
const LABEL = "com.hq.dev";
const PLIST = path.join(os.homedir(), ".claude", "hq", `${LABEL}.plist`);

const domain = () => `gui/${process.getuid?.() ?? 501}`;

// Loaded in launchd = running (KeepAlive holds the process while bootstrapped).
export function hqDevRunning(): boolean {
  try {
    execFileSync("launchctl", ["print", `${domain()}/${LABEL}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Idempotent: bootstrap when turning on, bootout when turning off, no-op when
// already there. Note: turning OFF from the :3002 dev server kills the very app
// serving the click — intended; the desktop app (:3009) is the safe cockpit.
export function setHqDev(enabled: boolean): boolean {
  const running = hqDevRunning();
  try {
    if (enabled && !running) {
      if (existsSync(PLIST)) execFileSync("launchctl", ["bootstrap", domain(), PLIST], { stdio: "ignore" });
    } else if (!enabled && running) {
      execFileSync("launchctl", ["bootout", `${domain()}/${LABEL}`], { stdio: "ignore" });
    }
  } catch {
    // fall through to re-reading the real state
  }
  return hqDevRunning();
}
