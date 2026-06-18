// HQ Live REPL — permission shim. A minimal stdio MCP server with one tool,
// `approve`, that Claude Code calls (via --permission-prompt-tool) for every tool
// permission decision it can't auto-resolve. Instead of deciding here, it
// long-polls HQ's own server: HQ surfaces the request to the browser (Approve/Deny
// card) and answers when you click. No npm deps — JSON-RPC over stdio by hand.
//
// Spawned by the `claude` process (declared in --mcp-config), so it inherits the
// env HQ set: HQ_PORT + HQ_REPL_SESSION.
const PORT = process.env.HQ_PORT || "3002";
const SESSION = process.env.HQ_REPL_SESSION || "";

let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim()) {
      try { handle(JSON.parse(line)); } catch { /* ignore non-JSON */ }
    }
  }
});

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

async function decide(args) {
  // Ask HQ (which asks you). HQ holds the response until you click; on any
  // failure we DENY (fail-safe — never auto-run something we couldn't gate).
  try {
    const res = await fetch(`http://localhost:${PORT}/api/terminal/repl/permission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION,
        tool_name: args.tool_name,
        input: args.input,
        tool_use_id: args.tool_use_id,
      }),
    });
    if (!res.ok) return { behavior: "deny", message: `HQ ${res.status}` };
    const d = await res.json();
    if (d && (d.behavior === "allow" || d.behavior === "deny")) return d;
    return { behavior: "deny", message: "HQ returned no decision" };
  } catch (e) {
    return { behavior: "deny", message: "HQ unreachable: " + (e?.message || e) };
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: {
      protocolVersion: params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "hq-approve", version: "1.0.0" },
    }});
  } else if (method === "notifications/initialized") {
    // notification — no reply
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: [{
      name: "approve",
      description: "Decide whether a requested tool use is permitted (routed to the HQ operator).",
      inputSchema: {
        type: "object",
        properties: {
          tool_name: { type: "string" },
          input: { type: "object", additionalProperties: true },
        },
        additionalProperties: true,
      },
    }] }});
  } else if (method === "tools/call") {
    const decision = await decide(params?.arguments ?? {});
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(decision) }] } });
  } else if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + method } });
  }
}
