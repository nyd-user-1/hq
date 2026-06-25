// HQ Live REPL — CLIENT to the persistent REPL daemon.
//
// The warm `claude` processes no longer live here. They live in a standalone
// daemon (lib/repl-daemon.mjs) that OUTLIVES the Next server — so a dev restart no
// longer wipes the pool or risks two processes resuming one transcript. This
// module keeps the exact public API the routes expect, but each call is now an RPC
// to the daemon over a unix domain socket. The daemon is lazily auto-spawned
// (detached + unref) on first use, so `npm run dev` is still the only thing to run.
//
// The Next side keeps everything that needs lib/* — notably resolving a session's
// cwd from its transcript (sessionCwd) — and passes plain data to the lean daemon.
// Permissions are owned end-to-end by the daemon (the shim posts to it directly),
// so this client no longer brokers them; it only relays the operator's answer.
import http from "node:http";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { sessionCwd } from "@/lib/transcript";

export type ReplEvent = Record<string, unknown> & { type?: string; subtype?: string };

export type PermissionDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message?: string };

const SOCK = path.join(os.homedir(), ".claude", "hq", "repl-daemon.sock");
function daemonPath(): string {
  return path.join(process.cwd(), "lib", "repl-daemon.mjs");
}

// ── transport: HTTP over the daemon's unix socket ────────────────────────────
function ping(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { socketPath: SOCK, path: "/ping", method: "GET", timeout: 800 },
      (res) => { res.resume(); resolve(res.statusCode === 200); },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function spawnDaemon(): void {
  const child = spawn(process.execPath, [daemonPath()], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, HQ_DAEMON_SOCK: SOCK },
  });
  child.unref();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Survive HMR re-eval (the memo resets, but a re-ping just finds the live daemon).
const g = globalThis as unknown as { __hqDaemonReady?: Promise<void> | null };
function ensureDaemon(): Promise<void> {
  if (g.__hqDaemonReady) return g.__hqDaemonReady;
  g.__hqDaemonReady = (async () => {
    if (await ping()) return;
    spawnDaemon();
    for (let i = 0; i < 40; i++) { // up to ~4s for the socket to come up
      if (await ping()) return;
      await sleep(100);
    }
    throw new Error("repl daemon failed to start");
  })().catch((e) => { g.__hqDaemonReady = null; throw e; });
  return g.__hqDaemonReady;
}

type HttpErr = Error & { code?: string };

function rawRequest<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath: SOCK,
        path: pathname,
        method,
        headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : undefined,
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d.toString()));
        res.on("end", () => { try { resolve(buf ? (JSON.parse(buf) as T) : ({} as T)); } catch { resolve({} as T); } });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Ensure the daemon is up, then make the call; if the socket vanished (daemon
// died between calls) respawn once and retry.
async function call<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  await ensureDaemon();
  try {
    return await rawRequest<T>(method, pathname, body);
  } catch (e) {
    const code = (e as HttpErr).code;
    if (code === "ECONNREFUSED" || code === "ENOENT") {
      g.__hqDaemonReady = null;
      await ensureDaemon();
      return rawRequest<T>(method, pathname, body);
    }
    throw e;
  }
}

// ── public API (same shape the routes have always called) ────────────────────
// Each call degrades gracefully if the daemon is unreachable, mirroring the old
// in-process "couldn't write" behavior (false / not-running) rather than 500ing —
// except startNewSession, where a failure must surface to the user.

type Status = {
  running: boolean;
  busy?: boolean;
  sessionId?: string | null;
  cwd?: string;
  startedAt?: number;
  lastActivity?: number;
};

// Start (or keep) the warm process for an EXISTING session. cwd is resolved HERE
// (the daemon has no transcript reader) from the session's own transcript.
export async function ensureRepl(requestedId: string, opts: { model?: string } = {}): Promise<void> {
  const cwd = sessionCwd(requestedId) ?? process.env.HOME ?? process.cwd();
  try { await call("POST", "/start", { session: requestedId, cwd, model: opts.model }); }
  catch { /* daemon unreachable — surfaced by the next status/send */ }
}

// Birth a BRAND-NEW session in `cwd`, driven by HQ. Throws on failure (the caller
// — the `new` action — try/catches and reports it).
export async function startNewSession(cwd: string, opts: { model?: string } = {}): Promise<string> {
  const r = await call<{ sessionId?: string }>("POST", "/new", { cwd, model: opts.model });
  if (!r.sessionId) throw new Error("daemon did not return a session id");
  return r.sessionId;
}

export async function replStatus(requestedId: string): Promise<Status> {
  try { return await call<Status>("GET", `/status?session=${encodeURIComponent(requestedId)}`); }
  catch { return { running: false }; }
}

export async function sendTurn(
  requestedId: string,
  payload: { text: string; images?: { data: string; mime: string }[] },
): Promise<boolean> {
  const cwd = sessionCwd(requestedId) ?? process.env.HOME ?? process.cwd();
  try {
    const r = await call<{ ok?: boolean }>("POST", "/send", {
      session: requestedId, cwd, text: payload.text, images: payload.images ?? [],
    });
    return r.ok === true;
  } catch { return false; }
}

export async function stopRepl(requestedId: string): Promise<boolean> {
  try { const r = await call<{ ok?: boolean }>("POST", "/stop", { session: requestedId }); return r.ok === true; }
  catch { return false; }
}

export async function resolvePermission(
  requestedId: string,
  toolUseId: string,
  decision: PermissionDecision,
): Promise<boolean> {
  try {
    const r = await call<{ ok?: boolean }>("POST", "/answer", { session: requestedId, tool_use_id: toolUseId, decision });
    return r.ok === true;
  } catch { return false; }
}

// The daemon self-reaps on its own timer; kept as a no-op so the route's
// opportunistic call site is unchanged.
export function reapIdle(): void { /* handled inside the daemon */ }

// Subscribe to a REPL's event stream. Opens a streaming /subscribe request to the
// daemon (which replays its buffer first, then streams live) and pipes each
// newline-delimited event to `cb`. Returns an unsubscribe that aborts the request
// — the daemon then runs its disconnect-grace release. Synchronous return so the
// SSE route's `unsub = subscribe(id, write)` shape is unchanged.
export function subscribe(requestedId: string, cb: (e: ReplEvent) => void): () => void {
  let req: http.ClientRequest | undefined;
  let aborted = false;
  (async () => {
    try { await ensureDaemon(); } catch { return; }
    if (aborted) return;
    req = http.request(
      { socketPath: SOCK, path: `/subscribe?session=${encodeURIComponent(requestedId)}`, method: "GET" },
      (res) => {
        let buf = "";
        res.on("data", (d) => {
          buf += d.toString();
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (line.trim()) { try { cb(JSON.parse(line) as ReplEvent); } catch { /* skip */ } }
          }
        });
        res.on("error", () => { /* stream ended */ });
      },
    );
    req.on("error", () => { /* daemon gone; EventSource will retry the route */ });
    req.end();
  })();
  return () => { aborted = true; try { req?.destroy(); } catch { /* already gone */ } };
}
