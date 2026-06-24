// HQ channel-mode toggle — the SINGLE SOURCE OF TRUTH for whether the
// EXPERIMENTAL channel-in path is active. Default OFF, so HQ always runs the
// proven warm-REPL ("MVP") path unless the operator explicitly opts in via the
// account menu (app/ui/account-chip.tsx). Stored as a tiny HQ-native sidecar
// (~/.claude/hq/channel-mode.json), like todo.json / sessions-meta.json.
//
// Why a global gate and not just per-session discovery: a stale discovery file
// (~/.claude/hq/channels/<id>.json) used to flip a session into channel mode with
// no consent — the "sticky" footgun. With this gate, OFF forces channelConnected
// = false in app/api/terminal/turns and refuses pushes in app/api/channel, so a
// leftover discovery file can never re-engage the channel path. OFF means MVP.
//
// Pure node:fs/os/path. Zero browser deps. Mirrors the other lib/*.ts readers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomicSync } from "@/lib/atomic";

function filePath(): string {
  return path.join(os.homedir(), ".claude", "hq", "channel-mode.json");
}

// Default OFF. A missing or corrupt file fails SAFE to the warm-REPL path.
export function isChannelEnabled(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), "utf8")) as { enabled?: unknown };
    return raw?.enabled === true;
  } catch {
    return false;
  }
}

export function setChannelEnabled(enabled: boolean): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true });
    writeFileAtomicSync(filePath(), JSON.stringify({ enabled }, null, 2));
  } catch {
    /* best-effort persist; the caller already has the intended value */
  }
  return enabled;
}
