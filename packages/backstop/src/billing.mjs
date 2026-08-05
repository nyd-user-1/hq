// Passes, balance, and Stripe. Zero dependencies — plain fetch against the
// REST API, same rule as the rest of hq.
//
// THE WEBHOOK PROBLEM, AND WHY THERE IS NO WEBHOOK.
// The usual shape is Stripe -> webhook -> durable store -> the thing that grants
// access. hq has no server and no database, and the checkout work stalled on
// exactly that. But backstop already runs a daemon on localhost that is up
// whenever a session is, so it can be its own redirect target: Checkout's
// `success_url` points at 127.0.0.1, the browser lands there after payment, and
// the gateway verifies the session against Stripe's API before granting
// anything. The browser is the messenger; Stripe is still the authority. No
// webhook, no public endpoint, no store to keep in sync.
//
// A user could of course open that url themselves — which is why the grant is
// gated on `payment_status: "paid"` fetched from Stripe, never on the redirect
// having happened.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { HQ_DIR, readState, patchState, readLedger } from "./state.mjs";

const PASSES_FILE = path.join(HQ_DIR, "backstop-passes.json");
const API = "https://api.stripe.com/v1";

// ---------------------------------------------------------------- the product
//
// One place for the business. Every number here is a guess to be tuned against
// real usage, so they live together rather than scattered through the code.
//
// `ceilingUsd` is the hard backend budget: the most raw provider spend a pass
// can draw before it stops. It is what makes a flat price safe — the buyer is
// definitionally the heaviest user at their heaviest hour, so an uncapped pass
// selects for exactly the people who exhaust it.
//
// It has to clear the re-warm. Moving a session to a provider that has never
// seen it costs one full pass over the context (~$6.25 at 1M Opus, ~$3.75 on
// Sonnet), so a ceiling that does not comfortably exceed that buys the handoff
// and nothing else.
export const PASSES = {
  day: {
    id: "day",
    label: "Day Pass",
    priceUsd: 20,
    hours: 24,
    ceilingUsd: 12,
    blurb: "24 hours of backstop capacity. Includes up to $12 of provider spend.",
  },
  bogo: {
    id: "bogo",
    label: "2-Day Pass",
    priceUsd: 25,
    hours: 48,
    ceilingUsd: 14,
    blurb: "48 hours of backstop capacity. Includes up to $14 of provider spend.",
  },
};

/**
 * Which pass to offer, from how long the wall actually lasts.
 *
 * A 5-hour reset does not need 48 hours of cover, and selling it anyway is how
 * a good deal turns into a resented one. The longer pass is offered only when
 * the reset is far enough out that the second day is genuinely useful — which
 * is also, not coincidentally, when its breakage is least likely to feel unfair.
 */
export function offerFor(state, now = Date.now()) {
  const resetAt = (state.planResetAt ?? 0) * 1000;
  const hoursOut = resetAt > now ? (resetAt - now) / 3_600_000 : 0;
  return hoursOut > 24 ? PASSES.bogo : PASSES.day;
}

// ------------------------------------------------------------------- the ledger

const readPasses = () => {
  try {
    return JSON.parse(fs.readFileSync(PASSES_FILE, "utf8"));
  } catch {
    return [];
  }
};

const writePasses = (list) => {
  fs.mkdirSync(HQ_DIR, { recursive: true });
  const tmp = `${PASSES_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`);
  fs.renameSync(tmp, PASSES_FILE);
};

/** Spend drawn against a pass — the provider's real bill, from the meter. */
function spentSince(iso) {
  const from = new Date(iso).getTime();
  return readLedger(100_000)
    .filter((e) => new Date(e.at).getTime() >= from)
    .reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
}

/**
 * The pass in force, with what is left on it. Null when there is none — which
 * is the state that sends the user to checkout.
 */
export function activePass(now = Date.now()) {
  for (const p of readPasses().slice().reverse()) {
    if (new Date(p.expiresAt).getTime() <= now) continue;
    const spentUsd = spentSince(p.startedAt);
    const remainingUsd = Math.max(0, p.ceilingUsd - spentUsd);
    if (remainingUsd <= 0) continue;
    return { ...p, spentUsd, remainingUsd };
  }
  return null;
}

export function grantPass(kind, stripeSessionId, now = Date.now()) {
  const spec = PASSES[kind] ?? PASSES.day;
  const list = readPasses();
  // One grant per Stripe session, ever. The success url is just a url; replaying
  // it must not mint a second pass.
  if (list.some((p) => p.stripeSessionId === stripeSessionId)) {
    return activePass(now);
  }
  const pass = {
    kind: spec.id,
    stripeSessionId,
    priceUsd: spec.priceUsd,
    ceilingUsd: spec.ceilingUsd,
    startedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + spec.hours * 3_600_000).toISOString(),
  };
  list.push(pass);
  writePasses(list);
  return activePass(now);
}

/** Add budget to the pass in force — what `/reload-5` buys. */
export function topUpPass(amountUsd, stripeSessionId, now = Date.now()) {
  const list = readPasses();
  if (list.some((p) => (p.topUps ?? []).some((t) => t.stripeSessionId === stripeSessionId))) {
    return activePass(now);
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (new Date(list[i].expiresAt).getTime() > now) {
      list[i].ceilingUsd += amountUsd;
      (list[i].topUps ??= []).push({ at: new Date(now).toISOString(), amountUsd, stripeSessionId });
      writePasses(list);
      return activePass(now);
    }
  }
  // Nothing live to top up: a reload with no pass buys a fresh day pass window.
  return grantPass("day", stripeSessionId, now);
}

// -------------------------------------------------------------------- Stripe

export function stripeKey() {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  // The gateway runs under launchd with a bare environment, so read the file
  // the rest of hq uses rather than depending on a shell.
  for (const p of [
    path.join(HQ_DIR, "backstop", "stripe.key"),
    path.join(HQ_DIR, "stripe.key"),
    path.join(process.env.HQ_REPO ?? "", ".env.local"),
  ]) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const m = raw.match(/^STRIPE_SECRET_KEY\s*=\s*["']?([^"'\s]+)/m);
      if (m) return m[1];
      if (raw.trim().startsWith("sk_") || raw.trim().startsWith("rk")) return raw.trim();
    } catch {
      /* next candidate */
    }
  }
  try {
    return execFileSync("security", ["find-generic-password", "-s", "hq-stripe", "-w"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

const form = (obj, prefix = "", out = []) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === "object") form(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
};

async function stripe(method, route, body) {
  const key = stripeKey();
  if (!key) throw new Error("no Stripe key (set STRIPE_SECRET_KEY or ~/.claude/hq/stripe.key)");
  const r = await fetch(`${API}/${route}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body ? form(body).join("&") : undefined,
  });
  const json = await r.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

/**
 * A hosted Checkout page for one pass. The user never types a card into a
 * terminal and never leaves for a dashboard — the same shape as `/login`:
 * a browser window opens, they approve, it closes.
 */
export async function createCheckout(kind, port, { topUpUsd } = {}) {
  const spec = PASSES[kind] ?? PASSES.day;
  const isTopUp = typeof topUpUsd === "number";
  const amount = Math.round((isTopUp ? topUpUsd : spec.priceUsd) * 100);
  const name = isTopUp ? `hq backstop — $${topUpUsd} top-up` : `hq ${spec.label}`;

  const session = await stripe("POST", "checkout/sessions", {
    mode: "payment",
    // The gateway is the redirect target: it is on localhost, it is already
    // running, and it can verify with Stripe before granting. That is the whole
    // reason this needs no webhook and no database.
    success_url: `http://127.0.0.1:${port}/_backstop/paid?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `http://127.0.0.1:${port}/_backstop/cancelled`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amount,
          product_data: { name, description: isTopUp ? "Adds budget to the pass in force." : spec.blurb },
        },
      },
    ],
    metadata: { kind: spec.id, topUpUsd: isTopUp ? String(topUpUsd) : "" },
  });
  return { url: session.url, id: session.id };
}

/** Ask Stripe whether this really was paid. Never trust the redirect alone. */
export async function verifyAndGrant(sessionId) {
  const s = await stripe("GET", `checkout/sessions/${sessionId}`);
  if (s.payment_status !== "paid") return { ok: false, reason: `payment_status=${s.payment_status}` };
  const topUpUsd = Number(s.metadata?.topUpUsd || 0);
  const pass = topUpUsd
    ? topUpPass(topUpUsd, sessionId)
    : grantPass(s.metadata?.kind ?? "day", sessionId);
  return { ok: true, pass, topUp: !!topUpUsd };
}

/** Open a url the way `/login` does. Best-effort; the url is printed regardless. */
export function openInBrowser(url) {
  try {
    execFileSync(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Stop the moment the pass is exhausted — the ceiling is the whole safety story. */
export function ceilingHit(now = Date.now()) {
  const pass = activePass(now);
  return !pass;
}

export { readPasses, PASSES_FILE };
export const _internals = { spentSince, readState, patchState };
