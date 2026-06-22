#!/usr/bin/env node
// HQ channel — an MCP "channel" server (Claude Code research preview, v2.1.80+)
// that lets the HQ dashboard PUSH events into a live session and, two-way,
// receive Claude's replies + relay permission prompts back to HQ.
//
// RESOLUTION: Claude's `--dangerously-load-development-channels server:hq` resolves
// the name from PERSISTENT MCP config (user/project/local scopes) only — it does
// NOT see `--mcp-config` inline servers. So bin/claude-hq registers this server in
// the cwd's local scope; the flag then resolves it.
//
// DORMANT BY DEFAULT: because it lives in config, Claude would otherwise load it in
// EVERY session of that repo. It stays inert unless HQ_CHANNEL_ACTIVE=1 (set by
// claude-hq) or an explicit HQ_CHANNEL_PORT/TOKEN is provided (HQ-spawned): no
// tools, no HTTP, no discovery file → invisible to normal sessions. Only when
// active does it bind a loopback port, self-issue a token, and write the discovery
// file HQ reads (so the file's presence TRUTHFULLY means a live channel).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

const ENV_PORT = Number(process.env.HQ_CHANNEL_PORT) || 0; // 0 → pick an ephemeral port
const ENV_TOKEN = process.env.HQ_CHANNEL_TOKEN || "";
const ACTIVE = process.env.HQ_CHANNEL_ACTIVE === "1" || (!!process.env.HQ_CHANNEL_PORT && !!ENV_TOKEN);
const ID = process.env.HQ_REPL_SESSION || `ext_${randomBytes(6).toString("hex")}`;
const TOKEN = ENV_TOKEN || randomBytes(24).toString("hex");
const CHANNELS_DIR = path.join(os.homedir(), ".claude", "hq", "channels");
const DISCOVERY = path.join(CHANNELS_DIR, `${ID}.json`);

const mcp = new Server(
  { name: "hq", version: "0.2.0" },
  ACTIVE
    ? {
        capabilities: {
          experimental: { "claude/channel": {}, "claude/channel/permission": {} },
          tools: {},
        },
        instructions:
          'Events from the HQ dashboard arrive as <channel source="hq" ...> — messages or ' +
          "signals from the operator's control panel for THIS session. Read them and act. " +
          "If a reply is warranted, call the `reply` tool with the chat_id from the inbound tag.",
      }
    : { capabilities: {} }, // dormant: not a channel, exposes nothing
);

const listeners = new Set();
function emit(o) {
  const line = `data: ${JSON.stringify(o)}\n\n`;
  for (const w of listeners) { try { w(line); } catch { /* dropped */ } }
}
async function notify(m) {
  try { await mcp.notification(m); return true; }
  catch (e) { console.error("[hq-channel] notify failed:", e?.message); return false; }
}

if (ACTIVE) {
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: "reply",
      description: "Send a message back to the HQ dashboard for this session.",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: { type: "string", description: "The HQ conversation to reply in (from the inbound tag)." },
          text: { type: "string", description: "The message to send back to HQ." },
        },
        required: ["text"],
      },
    }],
  }));
  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === "reply") {
      const { chat_id = "", text } = req.params.arguments ?? {};
      emit({ type: "reply", chat_id, text, session: ID });
      return { content: [{ type: "text", text: "sent" }] };
    }
    throw new Error(`unknown tool: ${req.params.name}`);
  });
  const PermissionRequestSchema = z.object({
    method: z.literal("notifications/claude/channel/permission_request"),
    params: z.object({ request_id: z.string(), tool_name: z.string(), description: z.string(), input_preview: z.string() }),
  });
  mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => emit({ type: "permission_request", session: ID, ...params }));
}

await mcp.connect(new StdioServerTransport()).catch((e) => console.error("[hq-channel] stdio connect failed:", e?.message));

if (!ACTIVE) {
  console.error("[hq-channel] dormant — run via claude-hq (sets HQ_CHANNEL_ACTIVE=1) to activate.");
} else {
  const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;
  let nextChatId = 1;
  const safeEq = (a, b) => { try { return timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; } };
  const tokenOK = (req) => { const g = req.headers["x-hq-token"]; return typeof g === "string" && g.length === TOKEN.length && safeEq(g, TOKEN); };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/events") {
      const q = url.searchParams.get("token") ?? "";
      if (q.length !== TOKEN.length || !safeEq(q, TOKEN)) { res.writeHead(403).end("forbidden"); return; }
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": connected\n\n");
      const w = (c) => res.write(c);
      listeners.add(w);
      req.on("close", () => listeners.delete(w));
      return;
    }
    if (req.method === "POST") {
      if (!tokenOK(req)) { res.writeHead(403).end("forbidden"); return; }
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
      req.on("end", async () => {
        const m = PERMISSION_REPLY_RE.exec(body);
        if (m) {
          const ok = await notify({ method: "notifications/claude/channel/permission", params: { request_id: m[2].toLowerCase(), behavior: m[1].toLowerCase().startsWith("y") ? "allow" : "deny" } });
          res.writeHead(200).end(JSON.stringify({ ok, verdict: true }));
          return;
        }
        const chat_id = String(nextChatId++);
        const source = (req.headers["x-hq-source"] || "ui").toString().replace(/[^a-z0-9_]/gi, "");
        const ok = await notify({ method: "notifications/claude/channel", params: { content: body, meta: { chat_id, kind: source } } });
        res.writeHead(200).end(JSON.stringify({ ok, chat_id }));
      });
      return;
    }
    res.writeHead(404).end("not found");
  });

  server.on("error", (e) => console.error("[hq-channel] http error:", e?.message));
  server.listen(ENV_PORT, "127.0.0.1", () => {
    const port = server.address().port;
    try {
      fs.mkdirSync(CHANNELS_DIR, { recursive: true });
      fs.writeFileSync(DISCOVERY, JSON.stringify({ id: ID, port, token: TOKEN, cwd: process.cwd(), pid: process.pid, startedAt: Math.floor(Date.now() / 1000) }));
    } catch (e) {
      console.error("[hq-channel] discovery write failed:", e?.message);
    }
    console.error(`[hq-channel] active on 127.0.0.1:${port} (id=${ID})`);
  });

  const cleanup = () => { try { fs.rmSync(DISCOVERY, { force: true }); } catch { /* ignore */ } };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
}
