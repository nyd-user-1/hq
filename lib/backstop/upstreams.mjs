// Upstream drivers. Each takes the client's request and pipes a response back,
// resolving with { model, usage } for metering (or null when nothing to meter).
//
// PRIVACY INVARIANT: the passthrough driver never inspects, buffers for
// inspection, or records a request or response body. Only backstop-routed
// traffic is metered, and even then only token counts are kept.
import https from "node:https";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { signRequest, resolveAws } from "./sigv4.mjs";
import { createEventStreamDecoder, toSse } from "./eventstream.mjs";
import { toBedrockModel, toMantleModel } from "./state.mjs";

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
export function viaBedrockClassic(req, res, body, state) {
  const aws = resolveAws();
  if (!aws) return upstreamError(res, "no AWS credentials resolvable for backstop");

  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return upstreamError(res, "backstop: request body was not JSON", 400);
  }

  const requestedModel = payload.model;
  const streaming = payload.stream === true;
  const profile = toBedrockModel(requestedModel);
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
        if (ur.statusCode !== 200) {
          let buf = "";
          ur.on("data", (d) => (buf += d));
          ur.on("end", () => {
            res.writeHead(ur.statusCode, { "content-type": "application/json" });
            res.end(translateAwsError(buf, ur.statusCode));
            resolve(null);
          });
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
            resolve({ model: requestedModel, usage });
          });
          return;
        }

        // Streaming: AWS event-stream frames -> Anthropic SSE.
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
        ur.on("end", () => {
          decoder.done();
          res.end();
          resolve({ model: requestedModel, usage });
        });
      },
    );
    up.on("error", (e) => resolve(upstreamError(res, `bedrock unreachable (${e.code ?? e.message})`)));
    up.end(outJson);
  });
}

// -------------------------------------------------------------- Bedrock (Mantle)

/**
 * Bedrock's Messages-API endpoint. No protocol translation at all — sign and
 * forward. Requires the account to be on the Mantle allowlist.
 */
export function viaMantle(req, res, body, state) {
  const aws = resolveAws();
  if (!aws) return upstreamError(res, "no AWS credentials resolvable for backstop");

  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return upstreamError(res, "backstop: request body was not JSON", 400);
  }
  const requestedModel = payload.model;
  const outJson = JSON.stringify({ ...payload, model: toMantleModel(requestedModel) });

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
export function viaAnthropicApi(req, res, body, state) {
  const key = resolveApiKey();
  if (!key) {
    return upstreamError(
      res,
      "backstop: no commercial API key installed (set ANTHROPIC_BACKSTOP_KEY or add keychain item 'hq-backstop')",
      503,
    );
  }
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return upstreamError(res, "backstop: request body was not JSON", 400);
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

  const outJson = JSON.stringify(payload);
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
      const tap = makeSseUsageTap();
      let jsonBuf = "";
      const isSse = (ur.headers["content-type"] ?? "").includes("event-stream");
      res.writeHead(ur.statusCode, ur.headers);
      ur.on("data", (chunk) => {
        if (ur.statusCode === 200) {
          if (isSse) tap.observe(chunk);
          else jsonBuf += chunk.toString("utf8");
        }
        res.write(chunk);
      });
      ur.on("end", () => {
        res.end();
        if (ur.statusCode !== 200) return resolve(null);
        let usage = tap.usage;
        if (!isSse) {
          try {
            usage = JSON.parse(jsonBuf).usage ?? {};
          } catch {
            usage = {};
          }
        }
        resolve({ model: requestedModel, usage });
      });
    });
    up.on("error", (e) => resolve(upstreamError(res, `${label} unreachable (${e.code ?? e.message})`)));
    up.end(body);
  });
}

/** Present an AWS-shaped failure in the Anthropic error envelope the CLI expects. */
function translateAwsError(raw, status) {
  let message = raw.slice(0, 400);
  try {
    const parsed = JSON.parse(raw);
    message = parsed.message ?? parsed.Message ?? parsed.error?.message ?? message;
  } catch {
    /* keep raw */
  }
  const type =
    status === 429 ? "rate_limit_error" : status === 403 ? "permission_error" : "api_error";
  return JSON.stringify({ type: "error", error: { type, message: `backstop/bedrock: ${message}` } });
}

function upstreamError(res, message, status = 502) {
  if (!res.headersSent) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message } }));
  } else {
    res.end();
  }
  return Promise.resolve(null);
}
