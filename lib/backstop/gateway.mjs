#!/usr/bin/env node
// The backstop gateway.
//
// Every Claude Code session on this machine is born pointing at this daemon
// (ANTHROPIC_BASE_URL in ~/.claude/settings.json), so it is already in the
// request path before any usage wall is hit. Normally it is a transparent
// passthrough to the user's own plan. When /backstop engages, the *next*
// request from every live session is routed to backstop capacity instead —
// no session is restarted, resumed, or respawned, and the TUI process never
// learns anything changed.
//
// It is a standalone daemon rather than a Next route on purpose: `next dev`
// restarts would otherwise take every Claude session on the machine down with
// them. launchd KeepAlive restarts it; `backstop-install.mjs --eject` removes
// it from the path entirely.
import http from "node:http";
import fs from "node:fs";
import {
  DEFAULT_PORT,
  LOG_FILE,
  HQ_DIR,
  readState,
  patchState,
  readLedger,
  appendLedger,
  costOf,
} from "./state.mjs";
import { passthrough, preflight, viaBedrockClassic, viaMantle, viaAnthropicApi } from "./upstreams.mjs";

const PORT = Number(process.env.HQ_BACKSTOP_PORT || DEFAULT_PORT);
const HOST = "127.0.0.1";

// After this many consecutive driver failures, stop paying a doomed round-trip
// on every turn and go straight to the user's plan for the cooldown. One probe
// is allowed through when it lapses, so recovery is automatic.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

fs.mkdirSync(HQ_DIR, { recursive: true });
const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* logging must never break the request path */
  }
  if (process.env.HQ_BACKSTOP_FOREGROUND) process.stdout.write(line);
};

const DRIVERS = {
  bedrock: viaBedrockClassic,
  "bedrock-mantle": viaMantle,
  anthropic: viaAnthropicApi,
};

// The usage wall, forged faithfully. Claude Code distinguishes the plan's
// 5-hour limit from a generic server limit by the unified rate-limit headers,
// so the rehearsal has to carry them or it exercises the wrong code path.
const LIMIT_BODY = JSON.stringify({
  type: "error",
  error: {
    type: "rate_limit_error",
    message:
      "You've reached your usage limit for this 5-hour window. Your limit will reset shortly.",
  },
});

const limitHeaders = () => ({
  "content-type": "application/json",
  "retry-after": "300",
  "anthropic-ratelimit-unified-status": "rejected",
  "anthropic-ratelimit-unified-reset": String(Math.floor(Date.now() / 1000) + 3 * 3600),
});

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.alloc(0)));
  });

const json = (res, status, obj) => {
  const payload = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};

const isInference = (req) => req.method === "POST" && req.url.startsWith("/v1/messages");

// ------------------------------------------------------------ control plane

async function control(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const route = url.pathname.replace("/_backstop/", "");
  const body = req.method === "POST" ? await readBody(req) : Buffer.alloc(0);
  let payload = {};
  try {
    payload = body.length ? JSON.parse(body.toString("utf8")) : {};
  } catch {
    /* tolerate an empty or malformed control body */
  }

  const state = readState();

  if (route === "health") return json(res, 200, { ok: true, port: PORT, pid: process.pid });

  if (route === "status") {
    const ledger = readLedger(1000);
    const spentUsd = ledger.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
    return json(res, 200, {
      ...state,
      spentUsd,
      requests: ledger.length,
      degraded: state.degradedUntil > Date.now(),
      port: PORT,
      pid: process.pid,
    });
  }

  // Engage. Unless forced, prove the provider can actually serve first —
  // promising rescue and delivering a fallback is how the wall gets worse
  // instead of better.
  if (route === "on" && req.method === "POST") {
    const want = { ...state, provider: payload.provider ?? state.provider, region: payload.region ?? state.region };
    if (!payload.force) {
      const probe = await preflight(want);
      if (!probe.ok) {
        log(`REFUSED to engage — ${want.provider} preflight failed: ${probe.reason}`);
        return json(res, 200, {
          ok: false,
          engaged: false,
          mode: state.mode,
          provider: want.provider,
          reason: probe.reason,
          status: probe.status,
        });
      }
    }
    const next = patchState({
      mode: "on",
      provider: want.provider,
      region: want.region,
      engagedAt: new Date().toISOString(),
      engagedReason: payload.reason ?? "user ran /backstop",
      consecutiveFailures: 0,
      degradedUntil: 0,
    });
    log(`ENGAGED provider=${next.provider} region=${next.region}${payload.force ? " (forced, unverified)" : " (verified)"}`);
    return json(res, 200, { ok: true, engaged: true, verified: !payload.force, ...next });
  }

  if (route === "off" && req.method === "POST") {
    const next = patchState({
      mode: "off",
      engagedAt: null,
      engagedReason: null,
      consecutiveFailures: 0,
      degradedUntil: 0,
    });
    log("DISENGAGED — back on the user's own plan");
    return json(res, 200, { ok: true, engaged: false, ...next });
  }

  if (route === "simulate" && req.method === "POST") {
    const next = patchState({ simulateLimit: payload.on !== false });
    log(`simulate-limit ${next.simulateLimit ? "ON" : "OFF"}`);
    return json(res, 200, { ok: true, ...next });
  }

  if (route === "override" && req.method === "POST") {
    const next = patchState({ upstreamOverride: payload.upstream ?? null });
    log(`upstream override -> ${next.upstreamOverride ?? "(none)"}`);
    return json(res, 200, { ok: true, ...next });
  }

  if (route === "ledger") return json(res, 200, { entries: readLedger(Number(url.searchParams.get("limit")) || 200) });

  return json(res, 404, { error: `unknown control route: ${route}` });
}

// --------------------------------------------------------------- the router

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/_backstop/")) {
    try {
      return await control(req, res);
    } catch (e) {
      return json(res, 500, { error: String(e?.message ?? e) });
    }
  }

  const state = readState();
  const body = await readBody(req);

  // Rehearsal: forge the wall on the passthrough path only. Backstop-routed
  // traffic must still succeed, or the test would prove nothing.
  if (state.simulateLimit && state.mode === "off" && isInference(req)) {
    log(`SIMULATED LIMIT -> 429 ${req.url}`);
    res.writeHead(429, limitHeaders());
    return res.end(LIMIT_BODY);
  }

  // Backstop is engaged. Try it — but a backstop that cannot serve must hand
  // the request back to the user's own plan, never fail the turn. Engaging is
  // therefore always safe: the worst case is the plan you already had.
  if (state.mode === "on" && isInference(req)) {
    const breakerOpen = state.degradedUntil > Date.now();
    if (!breakerOpen) {
      const driver = DRIVERS[state.provider] ?? viaBedrockClassic;
      const started = Date.now();
      let result;
      try {
        result = await driver(req, res, body, state);
      } catch (e) {
        result = { served: false, reason: String(e?.message ?? e) };
      }

      if (result?.served) {
        if (state.consecutiveFailures) patchState({ consecutiveFailures: 0, degradedUntil: 0 });
        if (result.model) {
          const costUsd = costOf(result.model, result.usage);
          appendLedger({
            at: new Date().toISOString(),
            provider: state.provider,
            model: result.model,
            ms: Date.now() - started,
            usage: result.usage,
            costUsd,
          });
          log(`metered ${result.model} $${costUsd.toFixed(4)}`);
        }
        return;
      }

      // Failed before writing a byte — record it and fall through to the plan.
      const fails = (state.consecutiveFailures ?? 0) + 1;
      patchState({
        consecutiveFailures: fails,
        degradedUntil: fails >= BREAKER_THRESHOLD ? Date.now() + BREAKER_COOLDOWN_MS : 0,
        lastDriverError: result?.reason ?? "unknown",
        lastDriverErrorAt: new Date().toISOString(),
      });
      log(
        `backstop upstream failed (${result?.status ?? "-"}): ${result?.reason ?? "unknown"} — falling back to the user's plan` +
          (fails >= BREAKER_THRESHOLD ? ` [breaker open ${BREAKER_COOLDOWN_MS / 1000}s after ${fails} failures]` : ""),
      );

      // Only unrecoverable if the driver already committed the response.
      if (res.headersSent) return res.end();
    }
  }

  // Passthrough — the user's own plan. Never metered, never logged by content.
  // Headers are read so hq can show plan headroom; bodies never are.
  return passthrough(req, res, body, state.upstreamOverride, (status, headers) => {
    if (!isInference(req)) return;
    const unified = headers["anthropic-ratelimit-unified-status"];
    const reset = headers["anthropic-ratelimit-unified-reset"];
    if (!unified && status !== 429) return;
    const patch = { planStatus: unified ?? null, planResetAt: reset ? Number(reset) : null, planSeenAt: new Date().toISOString() };
    if (status === 429 || unified === "rejected") {
      patch.lastLimitAt = new Date().toISOString();
      log(`usage wall observed on the user's plan (status=${unified ?? status})`);
    }
    patchState(patch);
  });
});

server.listen(PORT, HOST, () => {
  const s = readState();
  log(`backstop gateway listening on http://${HOST}:${PORT} (mode=${s.mode} provider=${s.provider})`);
});

const shutdown = () => {
  log("shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
