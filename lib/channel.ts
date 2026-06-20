// HQ-side CHANNEL client + session manager. The WRITE half of "Option B": HQ
// LAUNCHES a channel-enabled `claude` process and DRIVES it.
//
//   • spawnChannelSession()  — launch a channel-enabled `claude`, kept ALIVE as a
//                              managed in-process child (see SPIKE FINDING below),
//                              tracked in a sidecar with pid+cwd, and resolve the
//                              transcript sessionId once it appears (so HQ's existing
//                              terminal view, lib/transcript.ts, renders the output —
//                              output does NOT come back through us).
//   • listChannelSessions()  — what HQ has spawned (with liveness).
//   • killChannelSession()   — stop a tracked session.
//   • sendToChannel()        — push a prompt into the session (→ sidecar POST /send).
//   • decidePermission()     — answer a relayed permission prompt (→ POST /permission).
//   • channelHealth()        — is the sidecar up?
//
// The sidecar (scripts/channel/hq-channel.mjs) owns the channel↔Claude link over
// stdio and exposes a localhost HTTP control plane on a FIXED port (3003). We are a
// thin fetch client to it, authenticated with the shared secret. Every fetch
// tolerates the sidecar being DOWN — returns a clear status, never throws.
//
// SPIKE FINDING (verified, 2026-06-20 — see the build report): a plain detached,
// no-TTY `claude` exits IMMEDIATELY. Without a TTY, Claude Code falls back to
// --print mode and errors "Input must be provided ... when using --print". The ONLY
// dependency-free way to keep a channel session alive is the same trick lib/repl.ts
// uses: run it as `-p --input-format stream-json --output-format stream-json` with a
// LIVE, held-open stdin pipe. In that mode (verified) the process stays alive AND
// Claude Code spawns the channel sidecar over stdio. So we manage the child IN
// PROCESS (held stdin), NOT detached. PTY (node-pty) is the alternative but adds a
// native dep — avoided. Lifecycle (global map across HMR, idle reaper) mirrors repl.ts.
//
// OPEN UNCERTAINTY (could not verify without the full bidirectional harness + live
// API calls): whether a channel push (POST /send) triggers a turn while stdin sits
// idle. The session stays ALIVE with an idle held pipe; whether the <channel> event
// alone wakes a new turn, or whether a stdin nudge is also needed, is the remaining
// thing the live interactive test must confirm.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHANNEL_PORT = Number(process.env.HQ_CHANNEL_PORT || 3003);
const CHANNEL_BASE = `http://127.0.0.1:${CHANNEL_PORT}`;
const SERVER_NAME = "hq";

const HQ_DIR = path.join(os.homedir(), ".claude", "hq");
const SESSIONS_PATH = path.join(HQ_DIR, "channel-sessions.json");
const SECRET_PATH = path.join(HQ_DIR, "channel-secret");
const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

const IDLE_MS = 30 * 60 * 1000; // reap a session untouched for 30 min

export type ChannelSession = {
  pid: number;
  cwd: string;
  startedAt: number;
  sessionId: string | null; // resolved from the transcript once it appears
  model?: string;
};

// In-process managed children, keyed by pid. We hold a reference (and the open
// stdin) so the `claude` process stays alive. Survives Next dev HMR via globalThis.
type Managed = {
  child: ChildProcess;
  cwd: string;
  startedAt: number;
  lastActivity: number;
  alive: boolean;
};
const g = globalThis as unknown as {
  __hqChannelKids?: Map<number, Managed>;
  __hqChannelReaper?: ReturnType<typeof setInterval>;
};
const kids: Map<number, Managed> = g.__hqChannelKids ?? (g.__hqChannelKids = new Map());

// ---- secret ---------------------------------------------------------------
// The sidecar writes ~/.claude/hq/channel-secret on first boot. We read the same
// file. If it's absent (sidecar never started), reads return null and the fetch
// wrappers report "not connected" rather than guessing.
function readSecret(): string | null {
  try {
    const s = fs.readFileSync(SECRET_PATH, "utf8").trim();
    return s || null;
  } catch {
    return null;
  }
}

// ---- session sidecar ------------------------------------------------------
function readSessions(): ChannelSession[] {
  try {
    const arr = JSON.parse(fs.readFileSync(SESSIONS_PATH, "utf8"));
    return Array.isArray(arr) ? (arr as ChannelSession[]) : [];
  } catch {
    return [];
  }
}

function writeSessions(list: ChannelSession[]) {
  try {
    fs.mkdirSync(HQ_DIR, { recursive: true });
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(list.slice(-100), null, 2));
  } catch {
    /* best-effort */
  }
}

// Liveness: an in-process managed child is authoritative; otherwise probe the pid.
function pidAlive(pid: number): boolean {
  const m = kids.get(pid);
  if (m) return m.alive;
  try {
    process.kill(pid, 0); // signal 0 = liveness probe, doesn't actually signal
    return true;
  } catch {
    return false;
  }
}

// ---- transcript sessionId resolution --------------------------------------
// ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl. Slug = cwd with / and . → -.
// (Same derivation lib/transcript.ts uses for SESSIONS_DIR.)
function projectDirFor(cwd: string): string {
  return path.join(PROJECTS_ROOT, cwd.replace(/[/.]/g, "-"));
}

// Newest .jsonl session id in this cwd's project dir, created at/after spawn.
function newestSessionId(cwd: string, afterMs: number): string | null {
  const dir = projectDirFor(cwd);
  let best: { id: string; mtime: number } | null = null;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const full = path.join(dir, name);
      let mtime = 0;
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        continue;
      }
      if (mtime < afterMs - 2000) continue; // 2s slack for clock/write skew
      if (!best || mtime > best.mtime) best = { id: name.replace(/\.jsonl$/, ""), mtime };
    }
  } catch {
    /* dir not created yet */
  }
  return best?.id ?? null;
}

// Resolve (and persist) the transcript sessionId for a tracked session. Cheap to
// call repeatedly — HQ polls this until it resolves, then renders that session in
// the terminal. Returns the id or null if not yet visible on disk.
export function resolveSessionId(pid: number): string | null {
  const list = readSessions();
  const s = list.find((x) => x.pid === pid);
  if (!s) return null;
  if (s.sessionId) return s.sessionId;
  const id = newestSessionId(s.cwd, s.startedAt);
  if (id) {
    s.sessionId = id;
    writeSessions(list);
  }
  return id;
}

// ---- spawn ----------------------------------------------------------------
export type SpawnResult = {
  ok: boolean;
  pid?: number;
  cwd?: string;
  sessionId?: string | null;
  error?: string;
};

// Launch a channel-enabled `claude`, kept alive via stream-json + a held stdin (see
// the SPIKE FINDING in the header — plain detached spawn dies instantly). The child
// is managed IN PROCESS: we keep its stdin open so the session persists, and the
// sidecar (the `server:hq` entry in .mcp.json) is spawned by claude over stdio.
//
// An optional first `prompt` is written as a stream-json user turn once the process
// is up; further prompts arrive via the channel (POST /send → notifications/claude/
// channel) — but a stdin turn is the reliable kickstart for the very first input.
export function spawnChannelSession(opts: {
  cwd: string;
  prompt?: string;
  model?: string;
}): SpawnResult {
  const { cwd } = opts;
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return { ok: false, error: `no such cwd: ${cwd}` };
  }

  const args = [
    "--dangerously-load-development-channels",
    `server:${SERVER_NAME}`,
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--replay-user-messages",
  ];
  if (opts.model) args.push("--model", opts.model);

  try {
    // NOT detached: HQ holds the child + its stdin so the session stays alive. The
    // process dies with the HQ server (acceptable — same contract as lib/repl.ts).
    const child = spawn("claude", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    const pid = child.pid;
    if (!pid) return { ok: false, error: "spawn returned no pid" };

    const managed: Managed = {
      child,
      cwd,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      alive: true,
    };
    kids.set(pid, managed);
    // Drain stdout/stderr so the pipe buffers never fill and stall the child. We
    // don't parse them — HQ reads OUTPUT off the transcript, not here.
    child.stdout?.on("data", () => {
      managed.lastActivity = Date.now();
    });
    child.stderr?.on("data", () => {});
    child.on("exit", () => {
      managed.alive = false;
    });

    const session: ChannelSession = {
      pid,
      cwd,
      startedAt: managed.startedAt,
      sessionId: null,
      model: opts.model,
    };
    const list = readSessions().filter((s) => pidAlive(s.pid)); // prune dead
    list.push(session);
    writeSessions(list);

    // Kickstart the first turn over stdin if a prompt was given. Subsequent prompts
    // flow through the channel (POST /send).
    if (opts.prompt && opts.prompt.trim() && child.stdin) {
      const msg = {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: opts.prompt }] },
      };
      try {
        child.stdin.write(JSON.stringify(msg) + "\n");
      } catch {
        /* if stdin write fails the session is likely dead; reflected in liveness */
      }
    }

    return { ok: true, pid, cwd, sessionId: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function listChannelSessions(): (ChannelSession & { alive: boolean })[] {
  reapIdle();
  const list = readSessions();
  // Best-effort: try to resolve any still-unresolved session ids on read.
  let mutated = false;
  for (const s of list) {
    if (!s.sessionId) {
      const id = newestSessionId(s.cwd, s.startedAt);
      if (id) {
        s.sessionId = id;
        mutated = true;
      }
    }
  }
  if (mutated) writeSessions(list);
  return list.map((s) => ({ ...s, alive: pidAlive(s.pid) }));
}

export function killChannelSession(pid: number): { ok: boolean; error?: string } {
  try {
    const m = kids.get(pid);
    if (m) {
      try {
        m.child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      m.alive = false;
      kids.delete(pid);
    } else if (pidAlive(pid)) {
      process.kill(pid, "SIGTERM");
    }
    const list = readSessions().filter((s) => s.pid !== pid);
    writeSessions(list);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Reap idle managed children + prune dead ones from the sidecar.
export function reapIdle() {
  const now = Date.now();
  for (const [pid, m] of kids) {
    if (!m.alive) {
      kids.delete(pid);
      continue;
    }
    if (now - m.lastActivity > IDLE_MS) {
      try {
        m.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      m.alive = false;
      kids.delete(pid);
    }
  }
  // Prune sidecar entries whose pid is no longer alive.
  const list = readSessions();
  const live = list.filter((s) => pidAlive(s.pid));
  if (live.length !== list.length) writeSessions(live);
}

// Background reaper (guarded so dev HMR re-eval never stacks intervals).
if (g.__hqChannelReaper) clearInterval(g.__hqChannelReaper);
g.__hqChannelReaper = setInterval(reapIdle, 60 * 1000);
(g.__hqChannelReaper as unknown as { unref?: () => void }).unref?.();

// ---- channel client (fetch wrappers to the sidecar) -----------------------
export type ChannelHealth =
  | { connected: true; port: number }
  | { connected: false; reason: string };

export async function channelHealth(): Promise<ChannelHealth> {
  try {
    const res = await fetch(`${CHANNEL_BASE}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { connected: false, reason: `health ${res.status}` };
    const j = (await res.json()) as { ok?: boolean };
    return j?.ok ? { connected: true, port: CHANNEL_PORT } : { connected: false, reason: "not ok" };
  } catch {
    return { connected: false, reason: "sidecar down" };
  }
}

type SendResult = { ok: boolean; error?: string };

async function post(pathname: string, body: unknown): Promise<SendResult> {
  const secret = readSecret();
  if (!secret) return { ok: false, error: "channel not connected (no secret)" };
  try {
    const res = await fetch(`${CHANNEL_BASE}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hq-secret": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${txt}`.trim() };
    }
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return j?.ok ? { ok: true } : { ok: false, error: j?.error || "no ok" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("timeout") ? "channel timeout" : "channel not connected" };
  }
}

// Push a prompt INTO the running session.
export function sendToChannel(text: string): Promise<SendResult> {
  return post("/send", { text });
}

// Answer a relayed permission prompt. behavior = 'allow' | 'deny'.
export function decidePermission(
  request_id: string,
  behavior: "allow" | "deny",
): Promise<SendResult> {
  return post("/permission", { request_id, behavior });
}

// The base + secret the SSE proxy route needs to subscribe to the sidecar.
export function channelStreamTarget(): { url: string; secret: string | null } {
  const secret = readSecret();
  return { url: `${CHANNEL_BASE}/events`, secret };
}

export { CHANNEL_PORT, CHANNEL_BASE };
