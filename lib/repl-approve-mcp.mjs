// HQ Live REPL — permission shim. A minimal stdio MCP server with one tool,
// `approve`, that Claude Code calls (via --permission-prompt-tool) for every tool
// permission decision it can't auto-resolve. Instead of deciding here, it
// long-polls the HQ REPL DAEMON over its unix socket: the daemon auto-resolves the
// safe calls and surfaces the rest to the browser (Approve/Deny card), answering
// when you click. Posting straight to the daemon (not Next) means gating no longer
// breaks when the Next server is busy or restarting. No npm deps — JSON-RPC over
// stdio by hand, plus node:http for the socket call.
//
// Spawned by the `claude` process (declared in --mcp-config), so it inherits the
// env the daemon set: HQ_DAEMON_SOCK (its unix socket) + HQ_REPL_SESSION.
import http from "node:http";
const SOCK = process.env.HQ_DAEMON_SOCK || "";
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

// POST the ask to the daemon's /permission over its unix socket and BLOCK until it
// answers (the daemon holds the request open up to its 10-min timeout). No client
// timeout set — a human may take a while to click.
function postPermission(payload) {
  return new Promise((resolve, reject) => {
    if (!SOCK) return reject(new Error("no HQ_DAEMON_SOCK"));
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        socketPath: SOCK,
        path: "/permission",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => {
          if (res.statusCode !== 200) return reject(new Error("HQ " + res.statusCode));
          try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function decide(args) {
  // Ask the daemon (which asks you). It holds the response until you click; on any
  // failure we DENY (fail-safe — never auto-run something we couldn't gate).
  try {
    const d = await postPermission({
      sessionId: SESSION,
      tool_name: args.tool_name,
      input: args.input,
      tool_use_id: args.tool_use_id,
    });
    // Claude Code's permission-prompt-tool expects a discriminated union:
    //   allow -> { behavior:"allow", updatedInput:<record> }  (updatedInput REQUIRED)
    //   deny  -> { behavior:"deny",  message:<string> }       (message REQUIRED)
    // HQ returns a bare {behavior}, so normalize here: echo the original tool input
    // back as updatedInput (unchanged), and always carry a deny message. Without
    // this, an approved tool fails schema validation ("expected record, received
    // undefined") instead of running.
    if (d && d.behavior === "allow") {
      const updatedInput =
        d.updatedInput && typeof d.updatedInput === "object" ? d.updatedInput : (args.input ?? {});
      return { behavior: "allow", updatedInput };
    }
    if (d && d.behavior === "deny") {
      return { behavior: "deny", message: typeof d.message === "string" ? d.message : "denied by HQ" };
    }
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
