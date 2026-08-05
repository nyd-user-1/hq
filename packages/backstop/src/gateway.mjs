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
  canonicalAlias,
  modelChain,
  shouldTryNextModel,
} from "./state.mjs";
import {
  passthrough,
  preflight,
  probeModels,
  viaBedrockClassic,
  viaMantle,
  viaAnthropicApi,
} from "./upstreams.mjs";
import { activePass, offerFor, createCheckout, verifyAndGrant } from "./billing.mjs";

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

// The model the live sessions are actually running, learned by watching traffic
// go past. `/backstop` arrives through a hook with no idea what the session is,
// and preflighting the wrong model proves nothing — entitlement is per-model.
let lastSeenModel = null;

// The one page the user ever sees from this daemon: the browser tab Stripe
// redirects into after paying. It exists to say "done, go back to the terminal"
// and nothing else — the work is in the terminal, not here.
const paidPage = (title, detail) => `<!doctype html><meta charset="utf-8">
<title>hq backstop</title>
<style>
  :root { color-scheme: dark light }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0b0b0d; color:#fafafa;
         font:15px/1.6 ui-sans-serif,-apple-system,system-ui,sans-serif }
  .card { text-align:center; padding:2.5rem 3rem }
  h1 { margin:0 0 .5rem; font-size:1.35rem; font-weight:600 }
  p { margin:0; color:#a1a1aa }
  .mark { font-size:2rem; margin-bottom:1rem; color:#fbbf24 }
</style>
<div class="card"><div class="mark">◆</div><h1>${title}</h1><p>${detail}</p></div>`;

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

  // ---------------------------------------------------------------- billing

  if (route === "checkout" && req.method === "POST") {
    const kind = payload.kind ?? offerFor(state).id;
    try {
      const { url, id } = await createCheckout(kind, PORT, { topUpUsd: payload.topUpUsd });
      log(`checkout opened (${payload.topUpUsd ? `$${payload.topUpUsd} top-up` : kind}) ${id}`);
      return json(res, 200, { ok: true, url, id, kind });
    } catch (e) {
      return json(res, 200, { ok: false, reason: String(e?.message ?? e) });
    }
  }

  // Stripe's redirect lands the BROWSER here. It is only a hint that something
  // happened — the grant is decided by asking Stripe directly.
  if (route === "paid") {
    const sessionId = url.searchParams.get("session_id");
    let body;
    try {
      const r = await verifyAndGrant(sessionId);
      body = r.ok
        ? paidPage("You're set.", `${r.topUp ? "Top-up added" : "Pass active"} — return to your terminal.`)
        : paidPage("Not completed.", r.reason);
      if (r.ok) log(`pass granted via ${sessionId} (${r.pass?.kind}, $${r.pass?.remainingUsd.toFixed(2)} available)`);
    } catch (e) {
      body = paidPage("Could not verify.", String(e?.message ?? e));
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(body);
  }

  if (route === "cancelled") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(paidPage("Cancelled.", "Nothing was charged. You can close this."));
  }

  if (route === "pass") {
    const pass = activePass();
    return json(res, 200, { ok: true, pass, offer: offerFor(state) });
  }

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
    // The model the asking session is actually running. Checking anything else
    // proves the wrong thing: entitlement and quota are per-model, so a
    // provider-level "yes" can still fail on the only model that matters.
    const wantModel = payload.model ?? lastSeenModel ?? "claude-haiku-4-5";

    // No pass, no spend. Answered before the preflight so an unfunded user is
    // not kept waiting on upstream round-trips for an answer already settled —
    // and so the terminal can offer the one thing that fixes it.
    const pass = activePass();
    if (!pass) {
      const offer = offerFor(state);
      log(`engage refused — no active pass (offering ${offer.id})`);
      return json(res, 200, {
        ok: false,
        engaged: false,
        code: "no_funds",
        reason: "no active pass",
        offer,
      });
    }

    let probe = { ok: true };
    if (!payload.force) {
      probe = await preflight(want, wantModel);
      if (!probe.ok) {
        log(`REFUSED to engage — ${want.provider} cannot serve ${wantModel}: ${probe.reason}`);
        return json(res, 200, {
          ok: false,
          engaged: false,
          mode: state.mode,
          provider: want.provider,
          model: wantModel,
          reason: probe.reason,
          status: probe.status,
        });
      }
    }

    // Learn the whole family once, so mid-turn substitution never costs a
    // failed round-trip. Cheap (one 1-token call per candidate) and it only
    // happens at engage.
    const { available } = await probeModels(want, modelChain(wantModel, null));

    const next = patchState({
      mode: "on",
      provider: want.provider,
      region: want.region,
      engagedAt: new Date().toISOString(),
      engagedReason: payload.reason ?? "user ran /backstop",
      consecutiveFailures: 0,
      degradedUntil: 0,
      availableModels: available,
      modelsProbedAt: new Date().toISOString(),
      lastServedModel: probe.model ?? null,
      lastSubstitution: probe.substituted ? `${probe.from} -> ${probe.model}` : null,
    });
    log(
      `ENGAGED provider=${next.provider} region=${next.region} model=${probe.model ?? wantModel}` +
        (probe.substituted ? ` (substituted for ${probe.from})` : "") +
        (payload.force ? " (forced, unverified)" : " (verified)"),
    );
    return json(res, 200, {
      ok: true,
      engaged: true,
      verified: !payload.force,
      served: probe.model ?? wantModel,
      substituted: !!probe.substituted,
      ...next,
    });
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

  if (isInference(req)) {
    try {
      const m = JSON.parse(body.toString("utf8")).model;
      if (m) lastSeenModel = m;
    } catch {
      /* body shape is the upstream's problem, not ours */
    }
  }

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
    // The ceiling, enforced on the turn rather than after it. An exhausted pass
    // releases backstop instead of quietly spending past what was bought; the
    // turn then goes to the user's own plan, which is where it would have gone
    // if backstop had never engaged.
    const pass = activePass();
    if (!pass) {
      patchState({ mode: "off", engagedAt: null, engagedReason: null });
      log("pass exhausted or expired — released, back on the user's own plan");
    }

    const breakerOpen = state.degradedUntil > Date.now();
    if (pass && !breakerOpen) {
      const driver = DRIVERS[state.provider] ?? viaBedrockClassic;
      const started = Date.now();
      let result;

      // The session asks for the model it was born with; this provider may not
      // carry it. Walk the family down until one serves. Nothing has been
      // written to `res` while a driver reports {served:false}, so each attempt
      // is safe — and a substitution never reaches the session, which sees the
      // model it asked for.
      let requested = null;
      try {
        requested = JSON.parse(body.toString("utf8")).model;
      } catch {
        /* not JSON — let the driver deal with it */
      }
      const chain = requested ? modelChain(requested, state.availableModels) : [null];
      let servedAs = null;

      for (const serveAs of chain) {
        try {
          result = await driver(req, res, body, state, serveAs ?? undefined);
        } catch (e) {
          result = { served: false, reason: String(e?.message ?? e) };
        }
        if (result?.served) {
          servedAs = serveAs;
          if (serveAs && serveAs !== canonicalAlias(requested)) {
            patchState({ lastServedModel: serveAs, lastSubstitution: `${requested} -> ${serveAs}` });
            log(`served ${requested} as ${serveAs} (not carried by ${state.provider})`);
          }
          break;
        }
        // Worth another model only when this one was refused or busy. A real
        // outage would fail the next one identically.
        if (res.headersSent || !shouldTryNextModel(result?.status, result?.reason ?? "")) break;
      }

      if (result?.served) {
        if (state.consecutiveFailures) patchState({ consecutiveFailures: 0, degradedUntil: 0 });
        if (result.model) {
          // Price what was actually SERVED, not what was asked for. The bill
          // comes from the provider for the model it really ran, and a
          // substitution can cross a price tier (an Opus request served as
          // Sonnet is a fifth the cost). Metering the request would quietly
          // desynchronise the ledger from the real spend the ceiling guards.
          const billedModel = servedAs ?? result.model;
          const costUsd = costOf(billedModel, result.usage);
          appendLedger({
            at: new Date().toISOString(),
            provider: state.provider,
            model: billedModel,
            requestedModel: result.model,
            ms: Date.now() - started,
            usage: result.usage,
            costUsd,
          });
          log(`metered ${billedModel} $${costUsd.toFixed(4)}`);
        }
        return;
      }

      // Failed before writing a byte — record it and fall through to the plan.
      const fails = (state.consecutiveFailures ?? 0) + 1;

      // The breaker exists so a dead upstream stops costing a round-trip per
      // turn. But it must not open while the plan is the thing that is refusing:
      // "fall back to the user's plan" is worthless at the wall, and every flip
      // back and forth re-sends the whole context as a fresh cache write — the
      // single most expensive thing backstop can do. When the plan is walled,
      // stay engaged and keep retrying the upstream.
      const planWalled = state.planStatus === "rejected" || (state.planResetAt ?? 0) * 1000 > Date.now();
      patchState({
        consecutiveFailures: fails,
        degradedUntil: !planWalled && fails >= BREAKER_THRESHOLD ? Date.now() + BREAKER_COOLDOWN_MS : 0,
        lastDriverError: result?.reason ?? "unknown",
        lastDriverErrorAt: new Date().toISOString(),
      });
      log(
        `backstop upstream failed (${result?.status ?? "-"}): ${result?.reason ?? "unknown"} — ` +
          (planWalled
            ? "the plan is walled too; staying engaged rather than paying a re-warm to flap"
            : "falling back to the user's plan") +
          (!planWalled && fails >= BREAKER_THRESHOLD
            ? ` [breaker open ${BREAKER_COOLDOWN_MS / 1000}s after ${fails} failures]`
            : ""),
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
