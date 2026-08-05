// Upstream drivers. Each takes the client's request and pipes a response back.
//
// DRIVER CONTRACT — every backstop driver resolves one of:
//
//   { served: true,  model, usage }   the response was written; meter it
//   { served: false, reason, status } NOTHING was written to `res`
//
// `served: false` is the load-bearing half. A driver must never write its own
// failure response, because the gateway's answer to a failed backstop is to
// retry the request on the user's own plan — and it can only do that if the
// response is still untouched. A driver that renders its own 502 forecloses
// that choice and turns "backstop is broken" into "your session is broken".
// (That was the real bug: a Bedrock 429 got translated into an Anthropic
// rate_limit_error and handed to the CLI, which backed off and retried into
// the same wall forever.) The one place a driver is allowed to commit is after
// headers are already on the wire — a mid-stream failure is unrecoverable, and
// it says so by resolving `served: true`.
//
// PRIVACY INVARIANT: the passthrough driver never inspects, buffers for
// inspection, or records a request or response body. Only backstop-routed
// traffic is metered, and even then only token counts are kept.
import https from "node:https";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { signRequest, resolveAws } from "./sigv4.mjs";
import { createEventStreamDecoder, toSse } from "./eventstream.mjs";
import { toBedrockModel, toMantleModel, modelChain, isModelUnavailable, isTransient } from "./state.mjs";

const ANTHROPIC_HOST = "api.anthropic.com";

/** Split a "host:port"/URL override into request options. Test-only path. */
function overrideTarget(override) {
  if (!override) return null;
  const u = new URL(override.includes("://") ? override : `http://${override}`);
  return {
    transport: u.protocol === "https:" ? https : http,
    hostname: u.hostname,
    port: u.port || (u.protocol === "https:" ? 443 : 80),
    insecure: u.protocol !== "https:",
  };
}

// ---------------------------------------------------------------- passthrough

/**
 * The user's own plan. Byte-faithful, unmetered, unlogged.
 *
 * `onResponse(status, headers)` sees the status line and headers only — never
 * the body. That is enough to read Anthropic's unified rate-limit headers, so
 * hq can show how close the plan is to its wall without reading any content.
 */
export function passthrough(req, res, body, override, onResponse) {
  const t = overrideTarget(override) ?? { transport: https, hostname: ANTHROPIC_HOST, port: 443 };
  return new Promise((resolve) => {
    const headers = { ...req.headers, host: t.hostname };
    delete headers["content-length"];
    if (body.length) headers["content-length"] = String(body.length);

    const up = t.transport.request(
      { hostname: t.hostname, port: t.port, path: req.url, method: req.method, headers },
      (ur) => {
        try {
          onResponse?.(ur.statusCode, ur.headers);
        } catch {
          /* observation must never break the request path */
        }
        res.writeHead(ur.statusCode, ur.headers);
        ur.pipe(res);
        ur.on("end", () => resolve(null));
      },
    );
    up.on("error", (e) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `backstop gateway: upstream unreachable (${e.code ?? e.message})` } }));
      } else res.end();
      resolve(null);
    });
    if (body.length) up.write(body);
    up.end();
  });
}

// ------------------------------------------------------------------ metering

/** Watch an SSE byte stream for usage without altering it. */
function makeSseUsageTap() {
  let tail = "";
  const usage = {};
  let model = null;
  return {
    usage,
    get model() {
      return model;
    },
    observe(chunk) {
      tail = (tail + chunk.toString("utf8")).slice(-16384);
      for (const line of tail.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.message?.usage) Object.assign(usage, ev.message.usage);
          if (ev.usage) Object.assign(usage, ev.usage);
          if (ev.message?.model) model = ev.message.model;
        } catch {
          /* partial frame — picked up on a later chunk */
        }
      }
    },
  };
}

// -------------------------------------------------------------- Bedrock (classic)

/**
 * Classic Bedrock InvokeModel. The account entitlement path — requires a
 * cross-region inference profile and translates the AWS event-stream framing
 * back into Anthropic SSE.
 */
// `serveAs` overrides which model is actually asked for upstream. The response
// is still stamped with `requestedModel`, so a substitution is invisible to the
// session — it never learns it moved, which is the entire point.
export function viaBedrockClassic(req, res, body, state, serveAs) {
  const aws = resolveAws();
  if (!aws) return failed("no AWS credentials resolvable for backstop");

  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return failed("request body was not JSON", 400);
  }

  const requestedModel = payload.model;
  const streaming = payload.stream === true;
  const profile = toBedrockModel(serveAs ?? requestedModel);
  const region = state.region || aws.region;

  // Bedrock takes the model in the URL and the API version in the body.
  const outBody = { ...payload, anthropic_version: "bedrock-2023-05-31" };
  delete outBody.model;
  delete outBody.stream;
  delete outBody.betas;
  const outJson = JSON.stringify(outBody);

  const canonicalPath =
    `/model/${encodeURIComponent(profile)}/` +
    (streaming ? "invoke-with-response-stream" : "invoke");
  const override = overrideTarget(state.upstreamOverride);
  const host = override?.hostname ?? `bedrock-runtime.${region}.amazonaws.com`;

  const signed = signRequest({
    method: "POST",
    host: override ? `${override.hostname}:${override.port}` : host,
    canonicalPath,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: outJson,
    region,
    service: "bedrock",
    credentials: aws.credentials,
  });

  const transport = override?.transport ?? https;
  const port = override?.port ?? 443;

  return new Promise((resolve) => {
    const up = transport.request(
      { hostname: override?.hostname ?? host, port, path: canonicalPath, method: "POST", headers: signed },
      (ur) => {
        // Bedrock refused. Report it — do NOT render it to the client. This is
        // the throttle/entitlement path (a 0 tokens-per-day quota lands here),
        // and it is exactly the case that has to fall back to the user's plan.
        if (ur.statusCode !== 200) {
          let buf = "";
          ur.on("data", (d) => (buf += d));
          ur.on("end", () => resolve(failedNow(awsReason(buf), ur.statusCode)));
          return;
        }

        if (!streaming) {
          let buf = "";
          ur.on("data", (d) => (buf += d));
          ur.on("end", () => {
            let out = buf;
            let usage = {};
            try {
              const parsed = JSON.parse(buf);
              usage = parsed.usage ?? {};
              parsed.model = requestedModel; // echo back what the client asked for
              out = JSON.stringify(parsed);
            } catch {
              /* pass through unparsed */
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(out);
            resolve({ served: true, model: requestedModel, usage });
          });
          return;
        }

        // Streaming: AWS event-stream frames -> Anthropic SSE. Past this
        // writeHead the response is committed and no fallback is possible.
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const usage = {};
        const decoder = createEventStreamDecoder((ev) => {
          if (ev.message?.usage) Object.assign(usage, ev.message.usage);
          if (ev.usage) Object.assign(usage, ev.usage);
          if (ev.message) ev.message.model = requestedModel;
          res.write(toSse(ev));
        });
        ur.on("data", (chunk) => decoder.push(chunk));
        ur.on("error", () => {
          res.end(); // committed mid-stream; the turn is lost either way
          resolve({ served: true, model: requestedModel, usage });
        });
        ur.on("end", () => {
          decoder.done();
          res.end();
          resolve({ served: true, model: requestedModel, usage });
        });
      },
    );
    up.on("error", (e) => resolve(failedNow(`bedrock unreachable (${e.code ?? e.message})`)));
    up.end(outJson);
  });
}

// -------------------------------------------------------------- Bedrock (Mantle)

/**
 * Bedrock's Messages-API endpoint. No protocol translation at all — sign and
 * forward. Requires the account to be on the Mantle allowlist.
 */
export function viaMantle(req, res, body, state, serveAs) {
  const aws = resolveAws();
  if (!aws) return failed("no AWS credentials resolvable for backstop");

  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return failed("request body was not JSON", 400);
  }
  const requestedModel = payload.model;
  const outJson = JSON.stringify({ ...payload, model: toMantleModel(serveAs ?? requestedModel) });

  const region = state.region || aws.region;
  const override = overrideTarget(state.upstreamOverride);
  const host = override?.hostname ?? `bedrock-mantle.${region}.api.aws`;
  const canonicalPath = "/anthropic/v1/messages";

  const signed = signRequest({
    method: "POST",
    host: override ? `${override.hostname}:${override.port}` : host,
    canonicalPath,
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
    body: outJson,
    region,
    service: "bedrock",
    credentials: aws.credentials,
  });

  return forwardSimple({
    res,
    transport: override?.transport ?? https,
    hostname: override?.hostname ?? host,
    port: override?.port ?? 443,
    path: canonicalPath,
    headers: signed,
    body: outJson,
    requestedModel,
    label: "bedrock-mantle",
  });
}

// ------------------------------------------------------------ Commercial API

function resolveApiKey() {
  if (process.env.ANTHROPIC_BACKSTOP_KEY) return process.env.ANTHROPIC_BACKSTOP_KEY;
  try {
    return execFileSync("security", ["find-generic-password", "-s", "hq-backstop", "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** hq's commercial API capacity. Swap the client's OAuth for the backstop key. */
export function viaAnthropicApi(req, res, body, state, serveAs) {
  const key = resolveApiKey();
  if (!key) {
    return failed(
      "no commercial API key installed (set ANTHROPIC_BACKSTOP_KEY or add keychain item 'hq-backstop')",
      503,
    );
  }
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return failed("request body was not JSON", 400);
  }

  const override = overrideTarget(state.upstreamOverride);
  const headers = { ...req.headers };
  delete headers.authorization; // the user's subscription OAuth must not leave
  delete headers.host;
  delete headers["content-length"];
  headers["x-api-key"] = key;
  headers["content-type"] = "application/json";
  // The OAuth-only beta doesn't apply to key auth.
  if (headers["anthropic-beta"]) {
    const kept = headers["anthropic-beta"]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("oauth-"));
    if (kept.length) headers["anthropic-beta"] = kept.join(",");
    else delete headers["anthropic-beta"];
  }

  const outJson = JSON.stringify(serveAs ? { ...payload, model: serveAs } : payload);
  headers["content-length"] = String(Buffer.byteLength(outJson));

  return forwardSimple({
    res,
    transport: override?.transport ?? https,
    hostname: override?.hostname ?? ANTHROPIC_HOST,
    port: override?.port ?? 443,
    path: req.url,
    headers,
    body: outJson,
    requestedModel: payload.model,
    label: "anthropic",
  });
}

// ------------------------------------------------------------------- helpers

/** Forward a native Messages-API request and tap usage on the way back. */
function forwardSimple({ res, transport, hostname, port, path, headers, body, requestedModel, label }) {
  return new Promise((resolve) => {
    const up = transport.request({ hostname, port, path, method: "POST", headers }, (ur) => {
      // Refusal — buffer it as a reason instead of relaying it, so the gateway
      // can still fall back to the user's own plan.
      if (ur.statusCode !== 200) {
        let buf = "";
        ur.on("data", (d) => (buf += d));
        ur.on("end", () => resolve(failedNow(`${label}: ${awsReason(buf)}`, ur.statusCode)));
        return;
      }

      const tap = makeSseUsageTap();
      let jsonBuf = "";
      const isSse = (ur.headers["content-type"] ?? "").includes("event-stream");
      res.writeHead(ur.statusCode, ur.headers);
      ur.on("data", (chunk) => {
        if (isSse) tap.observe(chunk);
        else jsonBuf += chunk.toString("utf8");
        res.write(chunk);
      });
      ur.on("error", () => {
        res.end();
        resolve({ served: true, model: requestedModel, usage: tap.usage });
      });
      ur.on("end", () => {
        res.end();
        let usage = tap.usage;
        if (!isSse) {
          try {
            usage = JSON.parse(jsonBuf).usage ?? {};
          } catch {
            usage = {};
          }
        }
        resolve({ served: true, model: requestedModel, usage });
      });
    });
    up.on("error", (e) => resolve(failedNow(`${label} unreachable (${e.code ?? e.message})`)));
    up.end(body);
  });
}

/** Pull the human-readable message out of an AWS/Anthropic error body. */
function awsReason(raw) {
  const text = String(raw ?? "");
  try {
    const parsed = JSON.parse(text);
    return parsed.message ?? parsed.Message ?? parsed.error?.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || "upstream refused without a message";
  }
}

/** A driver failure the gateway is free to retry elsewhere. */
const failedNow = (reason, status = 502) => ({ served: false, reason, status });
const failed = (reason, status = 502) => Promise.resolve(failedNow(reason, status));

// ------------------------------------------------------------------ preflight

/** Swallows everything a driver writes — lets preflight run the REAL path. */
function sinkResponse() {
  return {
    headersSent: false,
    writeHead() {
      this.headersSent = true;
    },
    write: () => true,
    end: () => {},
  };
}

/**
 * Prove the configured provider can actually serve a token before we promise
 * the user it can. Runs one genuine minimal request down the real driver, into
 * a sink — same signing, same host, same model mapping, no output.
 *
 * Probes haiku because it is the cheapest. A quota block (the 0 TPD case) hits
 * every model alike, so that reads true; an account entitled to *only* a larger
 * model would read as a false negative, which is what `/backstop force` is for.
 */
export function driverFor(provider) {
  return (
    { bedrock: viaBedrockClassic, "bedrock-mantle": viaMantle, anthropic: viaAnthropicApi }[provider] ??
    viaBedrockClassic
  );
}

const PROBE_REQ = { method: "POST", url: "/v1/messages", headers: { "content-type": "application/json" } };
const probeBody = (model) =>
  Buffer.from(JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }));

/** One real minimal call for `model`. Serves nothing; only reports feasibility. */
async function tryModel(state, model) {
  try {
    const r = await driverFor(state.provider)(PROBE_REQ, sinkResponse(), probeBody(model), state, model);
    return r?.served ? { ok: true } : { ok: false, reason: r?.reason ?? "unknown", status: r?.status };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
}

/**
 * Ask the provider what it will actually serve, one cheap call per candidate.
 * An entitlement or quota answer is per-MODEL, so "can backstop serve?" has no
 * single answer — Bedrock routinely carries a working Opus 4.5 while denying
 * Opus 5 outright. Engaging on a provider-level yes and then failing on the
 * session's own model is the failure this exists to prevent.
 */
export async function probeModels(state, candidates) {
  const available = [];
  const denied = {};
  for (const m of candidates) {
    let r = await tryModel(state, m);
    // Probing walks a family back-to-back, which is itself enough to trip a
    // per-model rate limit. Retry once before believing a transient answer —
    // the cost of getting this wrong is a silent permanent downgrade.
    if (!r.ok && isTransient(r.status, r.reason)) {
      await new Promise((f) => setTimeout(f, 400));
      r = await tryModel(state, m);
    }
    // A throttle proves entitlement: the account has the model, it is busy.
    if (r.ok || isTransient(r.status, r.reason)) available.push(m);
    else denied[m] = r.reason;
  }
  return { available, denied };
}

/**
 * Prove the provider can serve before promising a rescue. `wantModel` is the
 * model the asking session is actually running, so the check is about the turn
 * that is really going to be made, not a stand-in.
 */
export async function preflight(state, wantModel) {
  const want = wantModel ?? "claude-haiku-4-5";
  let first = await tryModel(state, want);
  if (!first.ok && isTransient(first.status, first.reason)) {
    await new Promise((f) => setTimeout(f, 400));
    first = await tryModel(state, want);
  }
  if (first.ok) return { ok: true, model: want };

  // Unavailable is not the same as unable. Walk the family down before giving
  // up — but only on an entitlement answer. A throttle here would resolve on
  // its own, and demoting the user's model because the provider was briefly
  // busy is worse than the short wait.
  if (wantModel && isModelUnavailable(first.status, first.reason)) {
    for (const alt of modelChain(wantModel, null).slice(1)) {
      const r = await tryModel(state, alt);
      if (r.ok) return { ok: true, model: alt, substituted: true, from: wantModel };
    }
  }
  return { ok: false, reason: first.reason, status: first.status };
}
