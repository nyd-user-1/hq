// HQ REPL DAEMON — the persistent owner of warm `claude` processes.
//
// WHY THIS EXISTS: the warm REPL used to live inside the Next process
// (globalThis.__hqRepls in lib/repl.ts). Children were parented to Next and Next
// owned their stdin/stdout — so every server restart WIPED the pool (in-flight
// turns, pending permission cards, warm context) and could spawn a second
// `claude` resuming the same transcript (interleave race). State that must
// outlive Next can't live inside Next. This standalone process owns the children;
// lib/repl.ts is now a thin client that RPCs to it over a unix domain socket.
// Restart Next all you want — the agents (and their warm context) survive.
//
// TRANSPORT: HTTP over a unix socket (~/.claude/hq/repl-daemon.sock). No TCP port
// (no allocation/collision, scoped to the user by fs perms — matches hq's
// no-network-surface ethos). node speaks it natively on both ends.
//
// LEAN ON PURPOSE: plain .mjs, zero `@/` imports, runs on bare `node` (no TS
// toolchain) so it survives independently and ships next to the shim it spawns.
// The Next side resolves anything that needs lib/* (e.g. a session's cwd) and
// passes it in as plain data. The ONE thing that must live here is the permission
// classifier — the decision resolves where the process lives, so it can't depend
// on Next being up (that was the channel-in footgun). Shared via
// ./permission-classify.mjs (one source of truth with the Next side).
import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, resolvePermissionMode } from "./permission-classify.mjs";

const HQ_DIR = path.join(os.homedir(), ".claude", "hq");
const SOCK = process.env.HQ_DAEMON_SOCK || path.join(HQ_DIR, "repl-daemon.sock");
const LOG = path.join(HQ_DIR, "repl-daemon.log");

const EVENT_CAP = 1500;
const IDLE_MS = 30 * 60 * 1000; // reap a REPL untouched for 30 min
// Browser gone this long (and not mid-turn) → release the process. Wider than the
// old in-process 20s because this grace now ALSO has to absorb a Next dev restart
// (the Next→daemon subscribe drops when Next bounces); a busy session is never
// reaped regardless, so in-flight work always survives.
const DISCONNECT_GRACE_MS = 45 * 1000;
const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000; // deny if unanswered for 10 min
const EMPTY_EXIT_MS = 30 * 60 * 1000; // self-exit after this long with zero sessions

function dlog(...args) {
  try {
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${args.join(" ")}\n`);
  } catch {
    /* logging is best-effort */
  }
}

/**
 * @typedef {Object} Repl
 * @property {import("node:child_process").ChildProcess} child
 * @property {string} requestedId
 * @property {string|null} sessionId
 * @property {string} cwd
 * @property {number} startedAt
 * @property {number} lastActivity
 * @property {boolean} busy
 * @property {boolean} alive
 * @property {string} stdoutBuf
 * @property {Array<Record<string, unknown>>} events
 * @property {Set<(e: Record<string, unknown>) => void>} subscribers
 * @property {Map<string, { request: any, resolve: (d:any)=>void, timer: any }>} pending
 * @property {any} [reapTimer]
 */

/** @type {Map<string, Repl>} */
const repls = new Map();
let lastNonEmpty = Date.now();

// ── process resolution (verbatim from the old lib/repl.ts) ───────────────────
// GUI-launched apps get a minimal PATH that omits where `claude` lives, so a bare
// spawn("claude") fails ENOENT. HQ_CLAUDE_BIN overrides; else probe common dirs.
function resolveClaudeBin() {
  const override = process.env.HQ_CLAUDE_BIN;
  if (override) return override;
  const home = os.homedir();
  const candidates = [
    path.join(home, ".npm-global", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".bun", "bin", "claude"),
    "/usr/bin/claude",
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* keep probing */ }
  }
  return "claude"; // rely on PATH (dev / interactive shell)
}

// The permission shim ships next to THIS file (lib/), so resolve it module-
// relative — robust no matter what cwd the detached daemon was launched from.
function shimPath() {
  return fileURLToPath(new URL("./repl-approve-mcp.mjs", import.meta.url));
}

// Surface HQ-driven sessions in Recents despite their "sdk-cli" entrypoint.
function recordDriven(id) {
  if (!id || id.startsWith("new:")) return;
  try {
    fs.mkdirSync(HQ_DIR, { recursive: true });
    const p = path.join(HQ_DIR, "repl-sessions.json");
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* fresh */ }
    if (!arr.includes(id)) {
      const next = [...arr, id].slice(-300);
      const tmp = path.join(HQ_DIR, `.repl-sessions.json.${randomUUID()}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(next));
      fs.renameSync(tmp, p);
    }
  } catch { /* best-effort */ }
}

// ── REPL lifecycle ───────────────────────────────────────────────────────────
function emit(repl, e) {
  repl.lastActivity = Date.now();
  repl.events.push(e);
  if (repl.events.length > EVENT_CAP) repl.events.splice(0, repl.events.length - EVENT_CAP);
  for (const cb of repl.subscribers) {
    try { cb(e); } catch { /* a dead subscriber shouldn't break the fan-out */ }
  }
}

function handleLine(repl, line) {
  if (!line.trim()) return;
  let e;
  try { e = JSON.parse(line); } catch { return; }
  // Learn the real session id from init (a NEW session won't match requestedId).
  if (e.type === "system" && e.subtype === "init" && typeof e.session_id === "string") {
    repl.sessionId = e.session_id;
  }
  if (e.type === "result") repl.busy = false; // turn complete
  emit(repl, e);
}

// Low-level spawn: create + register a REPL under `key`. `resumeId` --resumes an
// existing session; `sessionId` births a new one with a preassigned id.
// NOTE: channels (HQ_CHANNELS=1) are intentionally NOT wired through the daemon in
// v1 — channel-in is off-by-default experimental and stays on hold here.
function spawnRepl(key, opts) {
  const mcpServers = { "hq-approve": { command: "node", args: [shimPath()] } };
  if (process.env.HQ_CHANNELS === "1") {
    dlog("HQ_CHANNELS=1 set but channels are not supported via the daemon (v1) — ignoring");
  }
  const mcpConfig = JSON.stringify({ mcpServers });

  // Mirror the user's Claude Code permission posture (their permissions.defaultMode)
  // instead of forcing "default" — so hq prompts exactly when their TUI would.
  const mode = resolvePermissionMode(opts.cwd);

  const args = [
    "-p",
    "--verbose",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--replay-user-messages",
    "--permission-mode", mode,
    "--mcp-config", mcpConfig,
    "--permission-prompt-tool", "mcp__hq-approve__approve",
    ...(opts.model ? ["--model", opts.model] : []),
    ...(opts.resumeId
      ? ["--resume", opts.resumeId]
      : opts.sessionId
        ? ["--session-id", opts.sessionId]
        : []),
  ];

  const child = spawn(resolveClaudeBin(), args, {
    cwd: opts.cwd,
    // Shim posts permission asks back to the DAEMON socket (not Next) — so
    // permissions no longer break when Next is busy/restarting.
    env: { ...process.env, HQ_DAEMON_SOCK: SOCK, HQ_REPL_SESSION: key },
    stdio: ["pipe", "pipe", "pipe"],
  });

  /** @type {Repl} */
  const repl = {
    child,
    requestedId: key,
    sessionId: opts.resumeId || opts.sessionId || null,
    cwd: opts.cwd,
    mode, // the permission mode this session was spawned with (for the classifier)
    startedAt: Date.now(),
    lastActivity: Date.now(),
    busy: false,
    alive: true,
    stdoutBuf: "",
    events: [],
    subscribers: new Set(),
    pending: new Map(),
  };
  repls.set(key, repl);
  lastNonEmpty = Date.now();
  recordDriven(key);

  child.stdout.on("data", (d) => {
    repl.stdoutBuf += d.toString();
    let i;
    while ((i = repl.stdoutBuf.indexOf("\n")) >= 0) {
      handleLine(repl, repl.stdoutBuf.slice(0, i));
      repl.stdoutBuf = repl.stdoutBuf.slice(i + 1);
    }
  });
  child.stderr.on("data", (d) => {
    emit(repl, { type: "hq_stderr", text: d.toString().slice(0, 2000) });
  });
  child.on("exit", (code, sig) => {
    repl.alive = false;
    repl.busy = false;
    if (repl.reapTimer) { clearTimeout(repl.reapTimer); repl.reapTimer = undefined; }
    emit(repl, { type: "hq_exit", code, signal: sig });
    for (const [, p] of repl.pending) { clearTimeout(p.timer); p.resolve({ behavior: "deny", message: "session ended" }); }
    repl.pending.clear();
  });
  child.on("error", (err) => {
    dlog("spawn error", key, String(err?.message || err));
    emit(repl, { type: "hq_stderr", text: "spawn error: " + String(err?.message || err) });
    repl.alive = false;
  });

  return repl;
}

// Start (or return) the REPL for an EXISTING session. `cwd` is resolved on the
// Next side (it has the transcript reader) and passed in.
function ensureRepl(requestedId, opts) {
  const existing = repls.get(requestedId);
  if (existing?.alive) return existing;
  const cwd = opts.cwd || process.env.HOME || process.cwd();
  return spawnRepl(requestedId, { cwd, resumeId: requestedId, model: opts.model });
}

// Birth a BRAND-NEW session in `cwd`, driven by HQ. Preassign the id (the fresh
// stream-json process won't emit init until its first turn, so we can't wait).
function startNewSession(cwd, opts) {
  const sessionId = randomUUID();
  spawnRepl(sessionId, { cwd, sessionId, model: opts.model });
  return sessionId;
}

function replStatus(requestedId) {
  const r = repls.get(requestedId);
  if (!r) return { running: false };
  return {
    running: r.alive,
    busy: r.busy,
    sessionId: r.sessionId,
    cwd: r.cwd,
    startedAt: r.startedAt,
    lastActivity: r.lastActivity,
  };
}

// Snapshot of EVERY REPL the daemon holds — the fleet. Cheap: only the metadata
// already tracked per process, no child I/O. This is the substrate for HQ's
// mission-control view (many top-level agents the daemon keeps warm at once).
function listAgents() {
  const out = [];
  for (const [key, r] of repls) {
    out.push({
      key,
      sessionId: r.sessionId,
      cwd: r.cwd,
      running: r.alive,
      busy: r.busy,
      startedAt: r.startedAt,
      lastActivity: r.lastActivity,
      pending: r.pending.size,
      subscribers: r.subscribers.size,
    });
  }
  return out;
}

function sendTurn(requestedId, payload) {
  const r = repls.get(requestedId);
  if (!r?.alive || !r.child.stdin) return false;
  const content = [];
  for (const img of payload.images ?? []) {
    content.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.data } });
  }
  if ((payload.text ?? "").trim()) content.push({ type: "text", text: payload.text });
  if (content.length === 0) return false;
  const msg = { type: "user", message: { role: "user", content } };
  r.busy = true;
  r.lastActivity = Date.now();
  r.child.stdin.write(JSON.stringify(msg) + "\n");
  emit(r, { type: "hq_sent", at: Date.now() });
  return true;
}

// Subscribe to a REPL's event stream. Replays the buffer first (so a fresh
// connection catches up), then streams live. Returns an unsubscribe that, when the
// last subscriber leaves, releases the process after a grace (unless mid-turn).
function subscribe(requestedId, cb) {
  const r = repls.get(requestedId);
  if (!r) return () => {};
  if (r.reapTimer) { clearTimeout(r.reapTimer); r.reapTimer = undefined; }
  for (const e of r.events) { try { cb(e); } catch { /* ignore */ } }
  r.subscribers.add(cb);
  return () => {
    r.subscribers.delete(cb);
    if (r.subscribers.size === 0 && !r.reapTimer) {
      r.reapTimer = setTimeout(() => {
        const cur = repls.get(requestedId);
        if (!cur) return;
        cur.reapTimer = undefined;
        if (cur.subscribers.size > 0 || cur.busy) return;
        stopRepl(requestedId);
        repls.delete(requestedId);
      }, DISCONNECT_GRACE_MS);
    }
  };
}

function stopRepl(requestedId) {
  const r = repls.get(requestedId);
  if (!r) return false;
  if (r.reapTimer) { clearTimeout(r.reapTimer); r.reapTimer = undefined; }
  try { r.child.kill("SIGTERM"); } catch { /* already gone */ }
  r.alive = false;
  return true;
}

// Permission bridge: the shim POSTs /permission and BLOCKS; we auto-resolve the
// safe/known calls via the classifier, or hold the request open and surface an
// Approve/Deny card to the browser (resolved via /answer). Keyed by tool_use_id.
function registerPermission(requestedId, request) {
  const r = repls.get(requestedId);
  const toolUseId = String(request.tool_use_id ?? request.toolUseId ?? randomUUID());

  let verdict;
  try {
    verdict = classify(
      {
        tool_name: typeof request.tool_name === "string" ? request.tool_name : undefined,
        input: request.input && typeof request.input === "object" ? request.input : undefined,
        input_preview: typeof request.input_preview === "string" ? request.input_preview : undefined,
      },
      undefined,
      r?.mode ?? "default", // match the session's permission mode (auto → no card)
    );
  } catch (e) {
    dlog("classify error", String(e?.message || e));
    verdict = "ask"; // fail-safe: escalate rather than auto-anything
  }
  if (verdict !== "ask") {
    if (r) emit(r, { type: "hq_permission_auto", tool_use_id: toolUseId, behavior: verdict, request });
    return Promise.resolve(
      verdict === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: "auto-denied by HQ permission policy" },
    );
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      r?.pending.delete(toolUseId);
      resolve({ behavior: "deny", message: "approval timed out" });
    }, PERMISSION_TIMEOUT_MS);
    if (r) {
      r.pending.set(toolUseId, { request, resolve, timer });
      emit(r, { type: "hq_permission", tool_use_id: toolUseId, request });
    } else {
      clearTimeout(timer);
      resolve({ behavior: "deny", message: "no active session" });
    }
  });
}

function resolvePermission(requestedId, toolUseId, decision) {
  const r = repls.get(requestedId);
  const p = r?.pending.get(toolUseId);
  if (!r || !p) return false;
  clearTimeout(p.timer);
  r.pending.delete(toolUseId);
  p.resolve(decision);
  emit(r, { type: "hq_permission_resolved", tool_use_id: toolUseId, behavior: decision.behavior });
  return true;
}

function reapIdle() {
  const now = Date.now();
  for (const [id, r] of repls) {
    if (!r.alive) { repls.delete(id); continue; }
    if (now - r.lastActivity > IDLE_MS) { stopRepl(id); repls.delete(id); }
  }
  if (repls.size > 0) lastNonEmpty = now;
  // Don't linger forever: an empty daemon self-exits (the client lazily respawns
  // one on the next drive). Keeps idle machines clean.
  else if (now - lastNonEmpty > EMPTY_EXIT_MS) {
    dlog("idle with zero sessions — exiting");
    shutdown(0);
  }
}

// ── HTTP server over the unix socket ─────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(body);
}

async function handle(req, res) {
  const url = new URL(req.url, "http://daemon");
  const p = url.pathname;
  const q = url.searchParams;

  if (req.method === "GET" && p === "/ping") return res.writeHead(200).end("ok");

  if (req.method === "GET" && p === "/status") {
    return json(res, 200, replStatus(q.get("session") || ""));
  }

  // The whole fleet (every warm agent). Read-only snapshot; the Next side
  // enriches each with project/title/branch from the transcript.
  if (req.method === "GET" && p === "/list") {
    return json(res, 200, { agents: listAgents() });
  }

  // Stream a REPL's events as newline-delimited JSON. The Next SSE route proxies
  // this to the browser. Held open; cleaned up when the request closes (which
  // also drives the disconnect-grace release).
  if (req.method === "GET" && p === "/subscribe") {
    const id = q.get("session") || "";
    res.writeHead(200, {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    const unsub = subscribe(id, (e) => { try { res.write(JSON.stringify(e) + "\n"); } catch { /* closed */ } });
    const ping = setInterval(() => { try { res.write("\n"); } catch { /* closed */ } }, 15000);
    const cleanup = () => { clearInterval(ping); unsub(); };
    req.on("close", cleanup);
    req.on("aborted", cleanup);
    return;
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    if (p === "/new") {
      const sessionId = startNewSession(body.cwd, { model: body.model });
      return json(res, 200, { ok: true, sessionId, cwd: body.cwd });
    }
    if (p === "/start") {
      ensureRepl(body.session, { cwd: body.cwd, model: body.model });
      return json(res, 200, { ok: true, status: replStatus(body.session) });
    }
    if (p === "/send") {
      ensureRepl(body.session, { cwd: body.cwd, model: body.model });
      const ok = sendTurn(body.session, { text: body.text ?? "", images: body.images ?? [] });
      return json(res, 200, { ok });
    }
    if (p === "/stop") {
      return json(res, 200, { ok: stopRepl(body.session) });
    }
    if (p === "/answer") {
      const ok = resolvePermission(body.session, String(body.tool_use_id), body.decision);
      return json(res, 200, { ok });
    }
    // Called by the MCP shim; BLOCKS until the operator answers (or it times out).
    if (p === "/permission") {
      if (!body?.sessionId) return json(res, 200, { behavior: "deny", message: "no session" });
      const decision = await registerPermission(body.sessionId, body);
      return json(res, 200, decision);
    }
  }

  res.writeHead(404).end("not found");
}

// ── boot: claim the socket (unlink a stale one), then serve ──────────────────
function serve() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      dlog("handler error", String(e?.message || e));
      try { json(res, 500, { error: String(e?.message || e) }); } catch { /* already sent */ }
    });
  });
  // Long-poll /permission (up to 10 min) and the held-open /subscribe stream must
  // not be killed by node's default request timeouts.
  server.requestTimeout = 0;
  server.timeout = 0;
  server.headersTimeout = 0;

  server.on("error", (err) => {
    if (err?.code === "EADDRINUSE") {
      // Lost a startup race — another daemon already owns the socket. Bow out.
      dlog("socket in use — another daemon owns it; exiting");
      process.exit(0);
    }
    dlog("server error", String(err?.message || err));
    process.exit(1);
  });

  server.listen(SOCK, () => {
    dlog(`listening on ${SOCK} (pid ${process.pid})`);
  });

  const reaper = setInterval(reapIdle, 60 * 1000);
  reaper.unref?.();

  return server;
}

function shutdown(code) {
  for (const [, r] of repls) { try { r.child.kill("SIGTERM"); } catch { /* gone */ } }
  try { if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK); } catch { /* best-effort */ }
  process.exit(code);
}

function boot() {
  fs.mkdirSync(HQ_DIR, { recursive: true });
  // A leftover socket file from a crashed daemon: if something live answers, defer
  // to it; otherwise unlink the stale node and claim it ourselves.
  if (fs.existsSync(SOCK)) {
    const probe = http.request({ socketPath: SOCK, path: "/ping", method: "GET", timeout: 800 }, (r) => {
      r.resume();
      dlog("a live daemon already owns the socket — exiting");
      process.exit(0);
    });
    probe.on("error", () => { // nobody home → stale socket
      try { fs.unlinkSync(SOCK); } catch { /* race; listen will surface EADDRINUSE */ }
      serve();
    });
    probe.on("timeout", () => { probe.destroy(); try { fs.unlinkSync(SOCK); } catch { /* */ } serve(); });
    probe.end();
  } else {
    serve();
  }
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
// One bad request must not crash a daemon that owns live agent processes.
process.on("uncaughtException", (e) => dlog("uncaughtException", String(e?.stack || e)));
process.on("unhandledRejection", (e) => dlog("unhandledRejection", String(e)));

boot();
