// HQ Live REPL — persistent `claude` stream-json processes, one per driven
// session. This is the WRITE half of HQ: where the read half tails the transcript
// the TUI writes, this OWNS a warm `claude` process and drives it. See the brief
// "The HQ Live REPL" (notes) for the full design + Phase 0 findings.
//
// One process per session, kept alive across turns (warm context). We speak the
// bidirectional stream-json protocol: user turns as JSON lines on stdin, streaming
// events (tokens, tool calls, results) on stdout. Tool permissions escalate to a
// local MCP shim (repl-approve-mcp.mjs) that long-polls /api/terminal/repl/permission
// → the browser renders Approve/Deny → the verdict rides back.
//
// SAFETY: this is a SIBLING process to any live TUI. The UX contract is "minimize
// the TUI, drive from HQ" — one active writer at a time. stopRepl() releases it.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionCwd } from "@/lib/transcript";
import { classify } from "@/lib/permission-policy";

// HQ-driven sessions are spawned via `claude -p`, so their transcript entrypoint
// is "sdk-cli" — which Recents filters out. Record the ids we drive in a sidecar
// so lib/sessions can surface them in Recents as the real sessions they are.
function recordDriven(id: string) {
  if (!id || id.startsWith("new:")) return;
  try {
    const dir = path.join(os.homedir(), ".claude", "hq");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "repl-sessions.json");
    let arr: string[] = [];
    try { arr = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* fresh */ }
    if (!arr.includes(id)) fs.writeFileSync(p, JSON.stringify([...arr, id].slice(-300)));
  } catch { /* best-effort */ }
}

export type ReplEvent = Record<string, unknown> & { type?: string; subtype?: string };

type PendingPermission = {
  request: ReplEvent;
  resolve: (decision: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type PermissionDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message?: string };

type Repl = {
  child: ChildProcess;
  requestedId: string;
  sessionId: string | null; // resolved from the init event
  cwd: string;
  startedAt: number;
  lastActivity: number;
  busy: boolean; // true between a sent turn and its result
  alive: boolean;
  stdoutBuf: string;
  events: ReplEvent[]; // ring buffer for late SSE subscribers
  subscribers: Set<(e: ReplEvent) => void>;
  pending: Map<string, PendingPermission>; // permission asks keyed by tool_use_id
  reapTimer?: ReturnType<typeof setTimeout>; // disconnect-grace kill (cleared on reconnect)
};

// Survive Next dev HMR (module re-eval) so we never orphan a running process.
const g = globalThis as unknown as {
  __hqRepls?: Map<string, Repl>;
  __hqReaper?: ReturnType<typeof setInterval>;
};
const repls: Map<string, Repl> = g.__hqRepls ?? (g.__hqRepls = new Map());

const EVENT_CAP = 1500;
const IDLE_MS = 30 * 60 * 1000; // reap a REPL untouched for 30 min
const DISCONNECT_GRACE_MS = 20 * 1000; // browser gone this long (no turn running) → release
const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000; // deny if unanswered for 10 min

function shimPath(): string {
  return path.join(process.cwd(), "lib", "repl-approve-mcp.mjs");
}

function emit(repl: Repl, e: ReplEvent) {
  repl.lastActivity = Date.now();
  repl.events.push(e);
  if (repl.events.length > EVENT_CAP) repl.events.splice(0, repl.events.length - EVENT_CAP);
  for (const cb of repl.subscribers) {
    try { cb(e); } catch { /* a dead subscriber shouldn't break the fan-out */ }
  }
}

function handleLine(repl: Repl, line: string) {
  if (!line.trim()) return;
  let e: ReplEvent;
  try { e = JSON.parse(line) as ReplEvent; } catch { return; }
  // Learn the real session id from init (a NEW session won't match requestedId).
  if (e.type === "system" && e.subtype === "init" && typeof e.session_id === "string") {
    repl.sessionId = e.session_id as string;
  }
  if (e.type === "result") repl.busy = false; // turn complete
  emit(repl, e);
}

// Low-level spawn: create + register a REPL under `key`. `resumeId` is the
// session to --resume ("" = a fresh session, whose real id arrives via init).
// HQ_REPL_SESSION = key so the permission shim posts back under the same key.
function spawnRepl(
  key: string,
  opts: { cwd: string; resumeId?: string; sessionId?: string; model?: string },
): Repl {
  const port = process.env.HQ_PORT ?? "3002";
  const mcpConfig = JSON.stringify({
    mcpServers: { "hq-approve": { command: "node", args: [shimPath()] } },
  });

  const args = [
    "-p",
    "--verbose",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--replay-user-messages",
    "--permission-mode", "default",
    "--mcp-config", mcpConfig,
    "--permission-prompt-tool", "mcp__hq-approve__approve",
    ...(opts.model ? ["--model", opts.model] : []),
    // resume an existing session, OR birth a new one with a preassigned id.
    ...(opts.resumeId
      ? ["--resume", opts.resumeId]
      : opts.sessionId
        ? ["--session-id", opts.sessionId]
        : []),
  ];

  const child = spawn("claude", args, {
    cwd: opts.cwd,
    env: { ...process.env, HQ_PORT: port, HQ_REPL_SESSION: key },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const repl: Repl = {
    child,
    requestedId: key,
    sessionId: opts.resumeId || opts.sessionId || null,
    cwd: opts.cwd,
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
  recordDriven(key); // surface HQ-driven sessions in Recents despite sdk-cli entrypoint

  child.stdout!.on("data", (d: Buffer) => {
    repl.stdoutBuf += d.toString();
    let i: number;
    while ((i = repl.stdoutBuf.indexOf("\n")) >= 0) {
      handleLine(repl, repl.stdoutBuf.slice(0, i));
      repl.stdoutBuf = repl.stdoutBuf.slice(i + 1);
    }
  });
  child.stderr!.on("data", (d: Buffer) => {
    emit(repl, { type: "hq_stderr", text: d.toString().slice(0, 2000) });
  });
  child.on("exit", (code, sig) => {
    repl.alive = false;
    repl.busy = false;
    if (repl.reapTimer) { clearTimeout(repl.reapTimer); repl.reapTimer = undefined; }
    emit(repl, { type: "hq_exit", code, signal: sig });
    // fail any outstanding permission asks closed
    for (const [, p] of repl.pending) { clearTimeout(p.timer); p.resolve({ behavior: "deny", message: "session ended" }); }
    repl.pending.clear();
  });

  return repl;
}

// Start (or return) the REPL for an EXISTING session (--resume from its own cwd).
export function ensureRepl(
  requestedId: string,
  opts: { model?: string } = {},
): Repl {
  const existing = repls.get(requestedId);
  if (existing?.alive) return existing;
  const cwd = sessionCwd(requestedId) ?? process.env.HOME ?? process.cwd();
  return spawnRepl(requestedId, { cwd, resumeId: requestedId, model: opts.model });
}

// Birth a BRAND-NEW session in `cwd`, driven by HQ. We PREASSIGN the id
// (--session-id) rather than waiting to learn it from init — a fresh stream-json
// process doesn't emit init until its first stdin turn, so waiting would hang.
// Keyed by the id from the start, so the UI's ensureRepl(id) finds this exact
// warm process (idempotent) instead of trying to --resume a not-yet-existing one.
export function startNewSession(cwd: string, opts: { model?: string } = {}): string {
  const sessionId = randomUUID();
  spawnRepl(sessionId, { cwd, sessionId, model: opts.model });
  return sessionId;
}

export function getRepl(requestedId: string): Repl | undefined {
  return repls.get(requestedId);
}

export function replStatus(requestedId: string) {
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

// Send a user turn into the warm process.
export function sendTurn(
  requestedId: string,
  payload: { text: string; images?: { data: string; mime: string }[] },
): boolean {
  const r = repls.get(requestedId);
  if (!r?.alive || !r.child.stdin) return false;
  const content: Record<string, unknown>[] = [];
  for (const img of payload.images ?? []) {
    content.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.data } });
  }
  if (payload.text.trim()) content.push({ type: "text", text: payload.text });
  if (content.length === 0) return false;
  const msg = { type: "user", message: { role: "user", content } };
  r.busy = true;
  r.lastActivity = Date.now();
  r.child.stdin.write(JSON.stringify(msg) + "\n");
  emit(r, { type: "hq_sent", at: Date.now() });
  return true;
}

// Subscribe to a REPL's event stream. Replays the buffered events first so a
// freshly-connected browser catches up, then streams live. Returns an unsubscribe.
export function subscribe(requestedId: string, cb: (e: ReplEvent) => void): () => void {
  const r = repls.get(requestedId);
  if (!r) return () => {};
  // A (re)connect cancels any pending disconnect-reap — a brief nav gap shouldn't kill the process.
  if (r.reapTimer) { clearTimeout(r.reapTimer); r.reapTimer = undefined; }
  for (const e of r.events) { try { cb(e); } catch { /* ignore */ } }
  r.subscribers.add(cb);
  return () => {
    r.subscribers.delete(cb);
    // Last browser gone → release the warm process after a short grace (unless mid-turn,
    // which the idle reaper will collect once it finishes). The grace absorbs page nav.
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

export function stopRepl(requestedId: string): boolean {
  const r = repls.get(requestedId);
  if (!r) return false;
  if (r.reapTimer) { clearTimeout(r.reapTimer); r.reapTimer = undefined; }
  try { r.child.kill("SIGTERM"); } catch { /* already gone */ }
  r.alive = false;
  return true;
}

// Permission bridge: the MCP shim calls registerPermission() (via the route) and
// awaits; the browser answers via resolvePermission(). Keyed by tool_use_id.
export function registerPermission(requestedId: string, request: ReplEvent): Promise<PermissionDecision> {
  const r = repls.get(requestedId);
  const toolUseId = String(request.tool_use_id ?? request.toolUseId ?? Math.random());

  // AUTO-MODE CLASSIFIER: decide the safe/known calls (read-only tools, read-only
  // Bash) per ~/.claude/hq/permission-policy.json so the operator isn't pinged on
  // every call. Only an "ask" verdict surfaces an Approve/Deny card; allow/deny
  // resolve immediately and are logged (hq_permission_auto) for the activity feed.
  const verdict = classify({
    tool_name: typeof request.tool_name === "string" ? request.tool_name : undefined,
    input:
      request.input && typeof request.input === "object"
        ? (request.input as Record<string, unknown>)
        : undefined,
  });
  if (verdict !== "ask") {
    if (r) emit(r, { type: "hq_permission_auto", tool_use_id: toolUseId, behavior: verdict, request });
    return Promise.resolve(
      verdict === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: "auto-denied by HQ permission policy" },
    );
  }

  return new Promise<PermissionDecision>((resolve) => {
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

export function resolvePermission(
  requestedId: string,
  toolUseId: string,
  decision: PermissionDecision,
): boolean {
  const r = repls.get(requestedId);
  const p = r?.pending.get(toolUseId);
  if (!r || !p) return false;
  clearTimeout(p.timer);
  r.pending.delete(toolUseId);
  p.resolve(decision);
  emit(r, { type: "hq_permission_resolved", tool_use_id: toolUseId, behavior: decision.behavior });
  return true;
}

// Reap idle REPLs. Called opportunistically from routes AND on the timer below.
export function reapIdle() {
  const now = Date.now();
  for (const [id, r] of repls) {
    if (!r.alive) { repls.delete(id); continue; }
    if (now - r.lastActivity > IDLE_MS) { stopRepl(id); repls.delete(id); }
  }
}

// Background reaper. reapIdle() also runs opportunistically on each POST, but if
// the browser closes there are no more POSTs — so without this a warm process
// would linger until the dev server dies (the orphaned-PID-3930 pattern). Guard
// with a global handle so dev HMR re-eval never stacks intervals.
if (g.__hqReaper) clearInterval(g.__hqReaper);
g.__hqReaper = setInterval(reapIdle, 60 * 1000);
(g.__hqReaper as unknown as { unref?: () => void }).unref?.();
