#!/usr/bin/env node
// End-to-end rehearsal of the /backstop use case, against a mock upstream that
// speaks the real wire protocols (Anthropic SSE + AWS event-stream framing).
//
// It proves every link except the final hop to a funded provider:
//   session born through the gateway -> usage wall -> /backstop -> the SAME
//   request path now served by backstop capacity -> metered -> flipped back.
//
//   node scripts/backstop-selftest.mjs
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { encodeEventStreamFrame } from "../packages/backstop/src/eventstream.mjs";

const execFile = promisify(execFileCb);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY = path.join(HERE, "..", "packages", "backstop", "src", "gateway.mjs");
const PORT = 3199;
const MOCK_PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}`;
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "backstop-selftest-"));

// A phrase that must never appear in any log or ledger written by passthrough.
const SECRET = "PRIVACY-CANARY-b7f2c1";

const AWS_KEY = process.env.AWS_ACCESS_KEY_ID ?? "AKIAMOCKSELFTEST0000";
const AWS_SECRET = process.env.AWS_SECRET_ACCESS_KEY ?? "mockSecretForSelfTestOnly000000000000000";

// -------------------------------------------------------- independent SigV4
// Deliberately NOT imported from packages/backstop/src/sigv4.mjs — a mock that trusts
// our own signer cannot catch our own signing bug. Written from the AWS spec:
// for every service but S3 the canonical URI is the wire path encoded a SECOND
// time, which is what a Bedrock profile id's colon ("-v1:0" -> %3A -> %253A)
// depends on.
const hmac = (k, s) => crypto.createHmac("sha256", k).update(s, "utf8").digest();
const sha = (d) => crypto.createHash("sha256").update(d ?? "").digest("hex");
const encSegment = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function verifySigV4(req, body) {
  const auth = req.headers.authorization ?? "";
  const m = auth.match(
    /Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]+)/,
  );
  if (!m) return { ok: false, why: "authorization header did not parse" };
  const [, , dateStamp, region, service, signedHeaders, signature] = m;

  const [pathOnly, query = ""] = req.url.split("?");
  const canonicalUri = pathOnly.split("/").map(encSegment).join("/");
  const names = signedHeaders.split(";");
  const canonicalHeaders = names
    .map((n) => `${n}:${String(req.headers[n] ?? "").trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const payloadHash = sha(body);
  const canonicalRequest = ["POST", canonicalUri, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", req.headers["x-amz-date"], scope, sha(canonicalRequest)].join("\n");
  let key = hmac(`AWS4${AWS_SECRET}`, dateStamp);
  for (const part of [region, service, "aws4_request"]) key = hmac(key, part);
  const expected = hmac(key, stringToSign).toString("hex");

  return expected === signature
    ? { ok: true, canonicalUri }
    : { ok: false, why: `signature mismatch — canonical uri should be ${canonicalUri}` };
}

let passes = 0;
let failures = 0;
const ok = (name, detail = "") => {
  passes++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`);
};
const fail = (name, detail) => {
  failures++;
  console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${detail}`);
};
const check = (name, cond, detail = "") => (cond ? ok(name, detail) : fail(name, detail || "assertion failed"));

// ------------------------------------------------------------- mock upstream

const seen = { passthrough: 0, bedrockInvoke: 0, bedrockStream: 0, bedrockRefused: 0, sigv4: [] };

// Flip this to make the mock's Bedrock side answer the way a 0-tokens-per-day
// account does. This is the exact upstream that locked an account out.
let bedrockRefuses = null; // null = healthy, else { status, body }

const ANTHROPIC_REPLY = (text, model) => ({
  id: "msg_mock",
  type: "message",
  role: "assistant",
  model,
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1200, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    // --- classic Bedrock
    const m = req.url.match(/^\/model\/(.+?)\/(invoke|invoke-with-response-stream)$/);
    if (m) {
      const profile = decodeURIComponent(m[1]);
      const auth = req.headers.authorization ?? "";
      seen.sigv4.push({
        profile,
        auth,
        hasDate: Boolean(req.headers["x-amz-date"]),
        body,
        url: req.url,
        sig: verifySigV4(req, body),
      });

      if (bedrockRefuses) {
        seen.bedrockRefused++;
        res.writeHead(bedrockRefuses.status, { "content-type": "application/json" });
        return res.end(JSON.stringify(bedrockRefuses.body));
      }

      if (m[2] === "invoke") {
        seen.bedrockInvoke++;
        res.writeHead(200, { "content-type": "application/json" });
        // Bedrock echoes no `model` field of its own choosing here.
        const r = ANTHROPIC_REPLY("BACKSTOP-BEDROCK-OK", undefined);
        delete r.model;
        return res.end(JSON.stringify(r));
      }

      seen.bedrockStream++;
      res.writeHead(200, { "content-type": "application/vnd.amazon.eventstream" });
      const events = [
        { type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", content: [], usage: { input_tokens: 1200, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "BACKSTOP-STREAM-OK" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 44 } },
        { type: "message_stop" },
      ];
      for (const ev of events) res.write(encodeEventStreamFrame(ev));
      return res.end();
    }

    // --- plain Anthropic Messages API (passthrough target + commercial driver)
    seen.passthrough++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(ANTHROPIC_REPLY("PASSTHROUGH-OK", "claude-haiku-4-5")));
  });
});

// ---------------------------------------------------------------- utilities

const post = (url, obj) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(obj ?? {}) }).then((r) =>
    r.json(),
  );

const sendMessage = (extra = {}) =>
  fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // What Claude Code actually sends: subscription OAuth, not an API key.
      authorization: "Bearer sk-ant-oat01-FAKE-SUBSCRIPTION-TOKEN",
      "anthropic-beta": "oauth-2025-04-20,claude-code-20250219",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 64,
      messages: [{ role: "user", content: `remember ${SECRET}` }],
      ...extra,
    }),
  });

/** Read a state-dir file, tolerating absence (an unwritten ledger is a pass). */
const readIfExists = (name) => {
  try {
    return fs.readFileSync(path.join(STATE_DIR, name), "utf8");
  } catch {
    return "";
  }
};

const waitFor = async (fn, ms = 8000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if (await fn()) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
};

// -------------------------------------------------------------------- run

// Engaging draws on a paid pass, so the rehearsal needs one. Written straight
// to the scratch dir rather than bought: this suite proves the SERVING path,
// and the purchase path has its own coverage that must not depend on a network
// round-trip to Stripe.
fs.writeFileSync(
  path.join(STATE_DIR, "backstop-passes.json"),
  JSON.stringify([
    {
      kind: "day",
      stripeSessionId: "cs_test_selftest",
      priceUsd: 20,
      ceilingUsd: 12,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    },
  ]),
);

const gateway = spawn(process.execPath, [GATEWAY], {
  env: {
    ...process.env,
    HQ_BACKSTOP_PORT: String(PORT),
    HQ_BACKSTOP_DIR: STATE_DIR,
    AWS_ACCESS_KEY_ID: AWS_KEY,
    AWS_SECRET_ACCESS_KEY: AWS_SECRET,
    AWS_REGION: "us-east-1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
gateway.stderr.on("data", (d) => process.stderr.write(`  [gateway] ${d}`));
gateway.stdout.on("data", (d) => process.stderr.write(`  [gateway] ${d}`));
// A gateway that dies mid-run makes every later assertion fail as "fetch
// failed", which says nothing. Say what actually happened.
let gatewayExit = null;
gateway.on("exit", (code, signal) => {
  gatewayExit = `code=${code} signal=${signal}`;
  process.stderr.write(`  \x1b[31m[gateway] EXITED ${gatewayExit}\x1b[0m\n`);
});

async function main() {
  await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
  const up = await waitFor(() => fetch(`${BASE}/_backstop/health`).then((r) => r.ok));
  if (!up) throw new Error("gateway did not come up");

  await post(`${BASE}/_backstop/override`, { upstream: `127.0.0.1:${MOCK_PORT}` });

  console.log("\n\x1b[1m1. Normal operation — the user's own plan\x1b[0m");
  {
    const r = await sendMessage();
    const j = await r.json();
    check("session reaches the API through the gateway", r.status === 200 && j.content?.[0]?.text === "PASSTHROUGH-OK");
    check("passthrough is not metered", readIfExists("backstop.jsonl").trim() === "", "ledger must stay empty");
  }

  console.log("\n\x1b[1m2. The wall — 5-hour limit hits three hours early\x1b[0m");
  {
    await post(`${BASE}/_backstop/simulate`, { on: true });
    const r = await sendMessage();
    const j = await r.json();
    check("session is refused with the usage-limit error", r.status === 429 && j.error?.type === "rate_limit_error");
  }

  console.log("\n\x1b[1m3. /backstop — one command, no restart\x1b[0m");
  {
    const engaged = await post(`${BASE}/_backstop/on`, { provider: "bedrock", reason: "selftest" });
    check("gateway flips to backstop capacity", engaged.mode === "on" && Boolean(engaged.engagedAt));

    const r = await sendMessage();
    const j = await r.json();
    check("the SAME request path now succeeds", r.status === 200 && j.content?.[0]?.text === "BACKSTOP-BEDROCK-OK");
    check("client sees the model id it asked for", j.model === "claude-haiku-4-5", `got ${j.model}`);

    const sig = seen.sigv4.at(-1);
    check("request was SigV4-signed", sig.auth.startsWith("AWS4-HMAC-SHA256 Credential="), sig.auth.slice(0, 42));
    check("credential scope targets bedrock", sig.auth.includes("/us-east-1/bedrock/aws4_request"));
    // The regression guard: AWS rejected every real call before this landed.
    check("signature validates against an independent SigV4 implementation", sig.sig.ok, sig.sig.why);
    check("wire path keeps the profile colon single-encoded", sig.url.includes("-v1%3A0"), sig.url);
    check("canonical uri double-encodes it for signing", sig.sig.canonicalUri?.includes("-v1%253A0"), sig.sig.canonicalUri);
    check("model mapped to a cross-region inference profile", sig.profile === "us.anthropic.claude-haiku-4-5-20251001-v1:0", sig.profile);
    check("subscription OAuth token never forwarded upstream", !sig.auth.includes("oat01") && !JSON.stringify(seen.sigv4).includes("FAKE-SUBSCRIPTION-TOKEN"));
    check("anthropic_version rewritten for Bedrock", JSON.parse(sig.body).anthropic_version === "bedrock-2023-05-31");
  }

  console.log("\n\x1b[1m4. Streaming — the shape a real TUI turn uses\x1b[0m");
  {
    const r = await sendMessage({ stream: true });
    const text = await r.text();
    check("AWS event-stream decoded back into Anthropic SSE", text.includes("event: message_start") && text.includes("event: message_stop"));
    check("assistant text survives the translation", text.includes("BACKSTOP-STREAM-OK"));
    check("SSE frames are well-formed", /^event: \w+\ndata: \{/m.test(text));
  }

  console.log("\n\x1b[1m5. Drawdown ledger\x1b[0m");
  {
    const { entries } = await fetch(`${BASE}/_backstop/ledger`).then((r) => r.json());
    check("every backstop request is metered", entries.length === 2, `${entries.length} entries`);
    check("token usage captured from the stream", entries.some((e) => e.usage?.output_tokens === 44));
    const status = await fetch(`${BASE}/_backstop/status`).then((r) => r.json());
    check("spend is totalled for the UI", status.spentUsd > 0, `$${status.spentUsd?.toFixed(4)}`);

    const written = readIfExists("backstop.jsonl") + readIfExists("backstop.log");
    check("no prompt content is ever written to disk", !written.includes(SECRET));
  }

  console.log("\n\x1b[1m6. The return trip — back on the user's own plan\x1b[0m");
  {
    await post(`${BASE}/_backstop/simulate`, { on: false });
    const off = await post(`${BASE}/_backstop/off`);
    check("gateway disengages", off.mode === "off" && off.engagedAt === null);
    const r = await sendMessage();
    const j = await r.json();
    check("traffic returns to the user's plan", r.status === 200 && j.content?.[0]?.text === "PASSTHROUGH-OK");
  }

  // ---------------------------------------------------------------- regression
  // Everything below rehearses the failure that locked a real account out:
  // backstop engaged against a Bedrock account whose tokens-per-day quota was 0.

  console.log("\n\x1b[1m7. The backstop itself fails — the session must NOT\x1b[0m");
  {
    await post(`${BASE}/_backstop/on`, { provider: "bedrock", reason: "selftest" });
    // Verbatim what AWS returns on a 0 tokens-per-day account.
    bedrockRefuses = {
      status: 429,
      body: { message: "Too many tokens per day, please wait before trying again." },
    };
    const before = seen.passthrough;

    const r = await sendMessage();
    const j = await r.json();
    check("a refusing upstream does not reach the client", r.status === 200, `got ${r.status}`);
    check("the turn is served by the user's own plan instead", j.content?.[0]?.text === "PASSTHROUGH-OK");
    check("the fallback really went upstream", seen.passthrough === before + 1);

    const st = await fetch(`${BASE}/_backstop/status`).then((x) => x.json());
    check("the failure is recorded, not swallowed", /too many tokens per day/i.test(st.lastDriverError ?? ""), st.lastDriverError);
    check("backstop stays engaged for when the quota returns", st.mode === "on");
  }

  console.log("\n\x1b[1m8. Circuit breaker — a dead upstream stops costing a round-trip\x1b[0m");
  {
    await sendMessage();
    await sendMessage(); // three consecutive failures total
    const st = await fetch(`${BASE}/_backstop/status`).then((x) => x.json());
    check("breaker opens after repeated failure", st.degraded === true, `failures=${st.consecutiveFailures}`);

    const refusedBefore = seen.bedrockRefused;
    const r = await sendMessage();
    check("further turns skip the dead upstream entirely", seen.bedrockRefused === refusedBefore);
    check("and are still served", r.status === 200 && (await r.json()).content?.[0]?.text === "PASSTHROUGH-OK");
    await post(`${BASE}/_backstop/off`);
  }

  console.log("\n\x1b[1m9. Preflight — /backstop refuses to promise what it cannot deliver\x1b[0m");
  {
    const refused = await post(`${BASE}/_backstop/on`, { provider: "bedrock", reason: "selftest" });
    check("engage is refused when the provider cannot serve", refused.ok === false && refused.engaged === false);
    check("the refusal carries the real upstream reason", /too many tokens per day/i.test(refused.reason ?? ""), refused.reason);

    const st = await fetch(`${BASE}/_backstop/status`).then((x) => x.json());
    check("the user is left on their own plan, unchanged", st.mode === "off");

    const forced = await post(`${BASE}/_backstop/on`, { provider: "bedrock", force: true });
    check("force engages anyway, unverified", forced.ok === true && forced.verified === false);
    await post(`${BASE}/_backstop/off`);
    bedrockRefuses = null;
  }

  console.log("\n\x1b[1m10. /backstop toggles — the same command out as in\x1b[0m");
  {
    // Must be async: the ctl script's engage triggers a preflight that comes
    // back to the mock server living in THIS process. Blocking the event loop
    // here would deadlock the request we are waiting on.
    const ctl = async (arg = "") =>
      (
        await execFile("bash", [path.join(HERE, "..", "packages", "backstop", "src", "backstop-ctl.sh"), arg], {
          encoding: "utf8",
          env: { ...process.env, HQ_BACKSTOP_PORT: String(PORT) },
        })
      ).stdout;

    const onOut = await ctl();
    const afterOn = await fetch(`${BASE}/_backstop/status`).then((x) => x.json());
    check("bare /backstop engages when released", afterOn.mode === "on", onOut.trim());

    const offOut = await ctl();
    const afterOff = await fetch(`${BASE}/_backstop/status`).then((x) => x.json());
    check("bare /backstop releases when engaged", afterOff.mode === "off", offOut.trim());
    // The terminal contract: one yellow line for the engage, one for the
    // release, and nothing else. Anything more is an artifact of the swap the
    // user is not supposed to see.
    check("and says so in one line", /Backstop disengaged/.test(offOut));
    check("without narrating", offOut.trim().split("\n").filter(Boolean).length === 1, offOut.trim());
    check("engaging is equally quiet", onOut.trim().split("\n").filter(Boolean).length === 1, onOut.trim());

    await ctl();
    await ctl("off");
    const explicit = await fetch(`${BASE}/_backstop/status`).then((x) => x.json());
    check("explicit /backstop off still releases", explicit.mode === "off");
  }
}

main()
  .catch((e) => fail("harness", `${e.stack ?? String(e)}${gatewayExit ? `\n      gateway exited: ${gatewayExit}` : ""}`))
  .finally(async () => {
    gateway.kill("SIGTERM");
    mock.close();
    console.log(`\n\x1b[1m${failures === 0 ? "\x1b[32mALL GREEN" : "\x1b[31mFAILURES"}\x1b[0m  ${passes} passed, ${failures} failed`);
    console.log(`\x1b[2mscratch state: ${STATE_DIR}\x1b[0m`);
    process.exit(failures === 0 ? 0 : 1);
  });
