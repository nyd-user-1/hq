#!/usr/bin/env node
// HQ Channel sidecar — the MCP server Claude Code spawns over stdio when a session
// is launched with `--dangerously-load-development-channels server:hq`. It is the
// INPUT path for HQ-driven sessions:
//
//   • PUSH a prompt INTO the session   → POST /send  → mcp.notification(claude/channel)
//   • RELAY permission prompts          → Claude Code notifies us, the CLASSIFIER
//                                         auto-decides safe ones, the rest stream
//                                         to HQ over SSE for the human to answer.
//   • A small `reply` tool              → explicit channel acks (output is primarily
//                                         read by HQ off the transcript, not here).
//
// OUTPUT (Claude's actual responses) does NOT flow through here — HQ already tails
// the session transcript (lib/transcript.ts) and renders it. This server is the
// write/control half only.
//
// It binds a localhost HTTP control plane on a FIXED port (3003) so HQ (Next.js on
// :3002) can talk to it. Inbound POSTs are gated by a shared secret read from
// ~/.claude/hq/channel-secret (created if absent) — localhost + single user, but
// the docs stress an ungated channel is a prompt-injection vector, so we gate.
//
// ONE dependency: @modelcontextprotocol/sdk (installed in scripts/channel/, kept
// out of HQ's 3-dep root). Everything else is node builtins.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const PORT = Number(process.env.HQ_CHANNEL_PORT || 3003);
const SERVER_NAME = "hq";

// --- shared secret ----------------------------------------------------------
const HQ_DIR = path.join(os.homedir(), ".claude", "hq");
const SECRET_PATH = path.join(HQ_DIR, "channel-secret");
function loadOrCreateSecret() {
  try {
    const s = fs.readFileSync(SECRET_PATH, "utf8").trim();
    if (s) return s;
  } catch {
    /* create below */
  }
  const s = crypto.randomBytes(24).toString("hex");
  try {
    fs.mkdirSync(HQ_DIR, { recursive: true });
    fs.writeFileSync(SECRET_PATH, s, { mode: 0o600 });
  } catch {
    /* best-effort; if we can't persist it, HQ reads the same path and also fails-open to no-gate? no — see check */
  }
  return s;
}
const SECRET = loadOrCreateSecret();

// --- policy (the classifier) ------------------------------------------------
// We read the SAME policy file lib/channel-policy.ts owns. Duplicated ruleset so
// this .mjs needs no TS import. Keep in sync with lib/channel-policy.ts.
const POLICY_PATH = path.join(HQ_DIR, "channel-policy.json");
const DEFAULT_POLICY = {
  allowTools: ["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "WebFetch", "WebSearch"],
  allowBashPatterns: [
    "^git (status|diff|log|show|branch|remote|stash list|rev-parse|describe|blame|shortlog)\\b",
    "^(ls|cat|pwd|echo|head|tail|wc|file|stat|tree|find|which|whoami|date|env|printenv|du|df)\\b",
    "^(npm (ls|list|view|outdated|run lint|run test|test)|node --version|npm --version|npx tsc --noEmit)\\b",
    "^(grep|rg|ag|ack|sort|uniq|cut|awk|sed -n)\\b",
  ],
  denyTools: [],
  denyBashPatterns: [],
};

function readPolicy() {
  try {
    const raw = fs.readFileSync(POLICY_PATH, "utf8");
    const p = JSON.parse(raw);
    return {
      allowTools: Array.isArray(p.allowTools) ? p.allowTools : DEFAULT_POLICY.allowTools,
      allowBashPatterns: Array.isArray(p.allowBashPatterns)
        ? p.allowBashPatterns
        : DEFAULT_POLICY.allowBashPatterns,
      denyTools: Array.isArray(p.denyTools) ? p.denyTools : DEFAULT_POLICY.denyTools,
      denyBashPatterns: Array.isArray(p.denyBashPatterns)
        ? p.denyBashPatterns
        : DEFAULT_POLICY.denyBashPatterns,
    };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

function matchesAny(patterns, text) {
  for (const src of patterns) {
    try {
      if (new RegExp(src).test(text)) return true;
    } catch {
      /* skip bad pattern */
    }
  }
  return false;
}

function bashCommandOf(inputPreview) {
  if (typeof inputPreview !== "string") return null;
  try {
    const obj = JSON.parse(inputPreview);
    if (obj && typeof obj.command === "string") return obj.command;
  } catch {
    /* not JSON */
  }
  return inputPreview;
}

// classify({tool_name, input_preview}) -> 'allow' | 'deny' | 'ask'
function classify({ tool_name, input_preview }) {
  const policy = readPolicy();
  const tool = tool_name || "";
  if (tool && policy.denyTools.includes(tool)) return "deny";
  if (tool === "Bash") {
    const cmd = bashCommandOf(input_preview);
    if (cmd != null) {
      const trimmed = cmd.trim();
      if (matchesAny(policy.denyBashPatterns, trimmed)) return "deny";
      if (matchesAny(policy.allowBashPatterns, trimmed)) return "allow";
    }
    return "ask";
  }
  if (tool && policy.allowTools.includes(tool)) return "allow";
  return "ask";
}

// --- SSE fan-out to HQ ------------------------------------------------------
const listeners = new Set();
function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of listeners) {
    try {
      res.write(payload);
    } catch {
      /* dead listener; cleaned on 'close' */
    }
  }
}

// --- MCP server -------------------------------------------------------------
const mcp = new Server(
  { name: SERVER_NAME, version: "0.1.0" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
      tools: {},
    },
    instructions:
      'You are being driven from HQ. Prompts arrive as <channel source="hq"> events — treat them as the operator\'s instructions and act on them in this session. ' +
      "Permission prompts are relayed to HQ and auto- or human-decided; just proceed. " +
      "Use the `reply` tool ONLY for short explicit acknowledgements the operator must see out-of-band; your normal work output is read by HQ from the transcript, so do not echo it through `reply`.",
  },
);

// reply tool — optional explicit ack path.
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a short out-of-band acknowledgement to the HQ operator. Use sparingly — normal output is already visible in HQ.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The acknowledgement to surface in HQ" },
        },
        required: ["text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === "reply") {
    const text = String(req.params.arguments?.text ?? "");
    broadcast({ kind: "reply", text, at: Date.now() });
    return { content: [{ type: "text", text: "sent" }] };
  }
  throw new Error(`unknown tool: ${req.params.name}`);
});

// permission relay — Claude Code (not Claude) notifies us when a dialog opens.
const PermissionRequestSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

// Track open requests so a late human verdict for an already auto-decided id is a no-op.
const openRequests = new Map(); // request_id -> { decided: boolean }

async function emitVerdict(request_id, behavior) {
  await mcp.notification({
    method: "notifications/claude/channel/permission",
    params: { request_id, behavior },
  });
}

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  const { request_id, tool_name, description, input_preview } = params;
  openRequests.set(request_id, { decided: false });

  const verdict = classify({ tool_name, input_preview });
  if (verdict === "allow" || verdict === "deny") {
    const rec = openRequests.get(request_id);
    if (rec) rec.decided = true;
    await emitVerdict(request_id, verdict);
    broadcast({
      kind: "auto",
      behavior: verdict,
      request_id,
      tool_name,
      description,
      input_preview,
      at: Date.now(),
    });
    return;
  }

  // Escalate to HQ for a human decision.
  broadcast({
    kind: "permission_request",
    request_id,
    tool_name,
    description,
    input_preview,
    at: Date.now(),
  });
});

await mcp.connect(new StdioServerTransport());

// --- HTTP control plane -----------------------------------------------------
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function authorized(req) {
  const h = req.headers["x-hq-secret"];
  return typeof h === "string" && h.length > 0 && h === SECRET;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy(); // cap inbound
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  // GET /health — unauthenticated liveness (no secret leak; just status).
  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, connected: true, server: SERVER_NAME, port: PORT });
  }

  // GET /events — SSE stream to HQ. Gated by secret in a query param OR header
  // (EventSource can't set headers, so HQ's proxy passes ?secret=).
  if (req.method === "GET" && url.pathname === "/events") {
    const secret = url.searchParams.get("secret") || req.headers["x-hq-secret"];
    if (secret !== SECRET) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    res.write(`data: ${JSON.stringify({ kind: "ready", at: Date.now() })}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* closed */
      }
    }, 15000);
    req.on("close", () => {
      clearInterval(ping);
      listeners.delete(res);
    });
    return;
  }

  // All mutating routes require the secret header.
  if (req.method === "POST") {
    if (!authorized(req)) return send(res, 403, { error: "forbidden" });
    const raw = await readBody(req);
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return send(res, 400, { error: "bad json" });
    }

    // POST /send { text } — push a prompt into the session.
    if (url.pathname === "/send") {
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim()) return send(res, 400, { error: "text required" });
      try {
        await mcp.notification({
          method: "notifications/claude/channel",
          params: { content: text, meta: { via: "hq" } },
        });
        broadcast({ kind: "sent", text, at: Date.now() });
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 500, { error: String(e?.message || e) });
      }
    }

    // POST /permission { request_id, behavior } — a human verdict from HQ.
    if (url.pathname === "/permission") {
      const request_id = String(body.request_id ?? "");
      const behavior = body.behavior === "allow" ? "allow" : body.behavior === "deny" ? "deny" : null;
      if (!request_id || !behavior) return send(res, 400, { error: "request_id + behavior required" });
      const rec = openRequests.get(request_id);
      if (rec && rec.decided) {
        // Already auto-decided (or answered) — apply-first-wins; this is a no-op.
        return send(res, 200, { ok: true, alreadyDecided: true });
      }
      if (rec) rec.decided = true;
      try {
        await emitVerdict(request_id, behavior);
        broadcast({ kind: "human", behavior, request_id, at: Date.now() });
        return send(res, 200, { ok: true });
      } catch (e) {
        return send(res, 500, { error: String(e?.message || e) });
      }
    }

    return send(res, 404, { error: "not found" });
  }

  res.writeHead(404);
  res.end("not found");
});

httpServer.on("error", (e) => {
  // EADDRINUSE means another sidecar already owns 3003. Log to stderr (visible in
  // the session debug log) and exit — Claude Code restarting the channel will retry.
  process.stderr.write(`[hq-channel] http error: ${e?.message || e}\n`);
  process.exit(1);
});

httpServer.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`[hq-channel] control plane on http://127.0.0.1:${PORT}\n`);
});

// Keep the process alive tied to stdio; if Claude Code closes stdin, exit cleanly.
process.stdin.on("close", () => {
  try {
    httpServer.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
});
