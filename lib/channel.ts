// HQ-side manager for per-session Claude Code channels (see channel/hq-channel.mjs
// + channel/README.md). Each HQ-spawned session gets its OWN loopback port +
// secret; this module allocates them, hands them to the spawn (lib/repl.ts), and
// is the only thing that talks to the channel subprocess's HTTP port.
//
// Keyed by the repl session KEY (the same id repl.ts uses), so /api/channel and
// the send box address a session the same way the rest of the terminal does.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { writeFileAtomicSync } from "@/lib/atomic";

export type ChannelInfo = { port: number; token: string };

const channels = new Map<string, ChannelInfo>();
// Sequential loopback ports from a high base. HQ owns allocation so two HQ
// sessions never collide; an external process already holding the port just
// means that session's channel fails to bind (logged, non-fatal). A restart
// resets the counter — acceptable for a localhost dev tool; harden later by
// having the server pick an ephemeral port and report it back.
let nextPort = 8800;

// Discovery dir: externally-launched sessions (bin/claude-hq) drop a
// {id,port,token,...} file here so HQ can find their channel. HQ-spawned
// sessions also write one (allocChannel) so both kinds are enumerable and
// survive a Next restart.
const CHANNELS_DIR = path.join(os.homedir(), ".claude", "hq", "channels");

export type Discovery = { id: string; port: number; token: string; cwd?: string; pid?: number; startedAt?: number };

function readDiscovery(key: string): ChannelInfo | null {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CHANNELS_DIR, `${key}.json`), "utf8")) as Discovery;
    if (d && typeof d.port === "number" && typeof d.token === "string") return { port: d.port, token: d.token };
  } catch {
    /* missing / corrupt */
  }
  return null;
}

// In-memory (HQ-spawned) first, then on-disk discovery (externally launched).
function resolve(key: string): ChannelInfo | null {
  return channels.get(key) ?? readDiscovery(key);
}

export function listChannels(): Discovery[] {
  try {
    return fs
      .readdirSync(CHANNELS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(CHANNELS_DIR, f), "utf8")) as Discovery;
        } catch {
          return null;
        }
      })
      .filter((d): d is Discovery => !!d);
  } catch {
    return [];
  }
}

export function channelServerPath(): string {
  // Mirrors shimPath() in repl.ts — resolved from the running app's cwd so it
  // works in the worktree and after merge alike.
  return path.join(process.cwd(), "channel", "hq-channel.mjs");
}

export function allocChannel(key: string): ChannelInfo {
  const existing = channels.get(key);
  if (existing) return existing;
  const info: ChannelInfo = { port: nextPort++, token: randomBytes(24).toString("hex") };
  channels.set(key, info);
  try {
    fs.mkdirSync(CHANNELS_DIR, { recursive: true });
    writeFileAtomicSync(
      path.join(CHANNELS_DIR, `${key}.json`),
      JSON.stringify({ id: key, port: info.port, token: info.token, startedAt: Date.now() } satisfies Discovery),
    );
  } catch {
    /* discovery is best-effort */
  }
  return info;
}

export function channelFor(key: string): ChannelInfo | null {
  return resolve(key);
}

export function dropChannel(key: string): void {
  channels.delete(key);
  try {
    fs.rmSync(path.join(CHANNELS_DIR, `${key}.json`), { force: true });
  } catch {
    /* ignore */
  }
}

// Push a message/event into the live session as a <channel source="hq"> event.
export async function pushToSession(
  key: string,
  content: string,
  opts: { source?: string } = {},
): Promise<boolean> {
  const ch = resolve(key);
  if (!ch) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${ch.port}/`, {
      method: "POST",
      headers: { "X-HQ-Token": ch.token, ...(opts.source ? { "X-HQ-Source": opts.source } : {}) },
      body: content,
    });
    return res.ok;
  } catch {
    return false; // channel not up (session not channel-enabled, or already gone)
  }
}

// Relay a permission verdict back to Claude Code ("yes <id>" / "no <id>").
export async function sendVerdict(key: string, requestId: string, allow: boolean): Promise<boolean> {
  const ch = resolve(key);
  if (!ch) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${ch.port}/`, {
      method: "POST",
      headers: { "X-HQ-Token": ch.token },
      body: `${allow ? "yes" : "no"} ${requestId}`,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Open the channel's outbound SSE (Claude replies + permission requests) so the
// /api/channel GET route can relay it to the browser. Null if no channel.
export async function channelEvents(
  key: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array> | null> {
  const ch = resolve(key);
  if (!ch) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${ch.port}/events?token=${encodeURIComponent(ch.token)}`, { signal });
    return res.body ?? null;
  } catch {
    return null;
  }
}
