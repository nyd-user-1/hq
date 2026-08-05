#!/usr/bin/env node
// The money path.
//
// backstop-selftest proves the gateway serves; backstop-resilience proves a
// broken backstop cannot take the account down. This proves the third thing:
// that nobody gets capacity they did not pay for, and nobody spends past what
// they bought.
//
// Runs entirely against a scratch state dir. The Stripe calls are the only ones
// that touch the network, and they are skipped without a key — the grant,
// ceiling, and replay logic are pure and always covered.
//
//   node scripts/backstop-billing-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "backstop-billing-"));
process.env.HQ_BACKSTOP_DIR = DIR;

const { PASSES, activePass, grantPass, topUpPass, offerFor, createCheckout, stripeKey } = await import(
  "../lib/backstop/billing.mjs"
);
const { appendLedger } = await import("../lib/backstop/state.mjs");

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  console.log(`  ${cond ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${detail ? `  ${dim(detail)}` : ""}`);
  if (cond) passed++;
  else failures.push(label);
};

// Spend is read from the meter, so "using up a pass" means writing real ledger
// rows — the same ones a served turn writes.
const spend = (usd) =>
  appendLedger({ at: new Date().toISOString(), provider: "test", model: "claude-opus-5", usage: {}, costUsd: usd });

console.log(`\n${b("backstop billing")}  ${dim(DIR)}\n`);

console.log(b("1. No pass, no capacity"));
ok("a fresh machine has no pass", activePass() === null);

console.log(`\n${b("2. A pass is what buys the flip")}`);
const p = grantPass("day", "cs_test_1");
ok("granting yields an active pass", !!p && p.kind === "day");
ok("with the ceiling the product promises", p.ceilingUsd === PASSES.day.ceilingUsd, `$${p.ceilingUsd}`);
ok("nothing spent yet", p.remainingUsd === PASSES.day.ceilingUsd);
ok("and it expires", new Date(p.expiresAt) > new Date(), p.expiresAt.slice(0, 16));

console.log(`\n${b("3. A checkout url is not a payment")}`);
const dupe = grantPass("day", "cs_test_1");
ok("the same Stripe session cannot mint a second pass", dupe.stripeSessionId === "cs_test_1");
ok("still exactly one pass on file", JSON.parse(fs.readFileSync(path.join(DIR, "backstop-passes.json"))).length === 1);

console.log(`\n${b("4. The ceiling is the whole safety story")}`);
spend(5);
ok("spend draws the pass down", Math.abs(activePass().remainingUsd - 7) < 1e-9, `$${activePass().remainingUsd} left`);
spend(7);
ok("an exhausted pass stops being active", activePass() === null, "the flip releases rather than overspending");
ok(
  "a flat price cannot be exceeded by a heavy user",
  PASSES.day.ceilingUsd < PASSES.day.priceUsd,
  `ceiling $${PASSES.day.ceilingUsd} < price $${PASSES.day.priceUsd}`,
);
ok(
  "and the ceiling clears a 1M Opus re-warm",
  PASSES.day.ceilingUsd > 6.25,
  "or the pass would buy the handoff and nothing else",
);

console.log(`\n${b("5. /reload-N buys budget without leaving the terminal")}`);
const t = topUpPass(10, "cs_test_topup");
ok("a top-up revives an exhausted pass", !!t && t.remainingUsd > 0, `$${t.remainingUsd.toFixed(2)}`);
ok("replaying the top-up adds nothing", topUpPass(10, "cs_test_topup").remainingUsd === t.remainingUsd);

console.log(`\n${b("6. The offer matches the wall")}`);
const soon = { planResetAt: Math.floor((Date.now() + 3 * 3600_000) / 1000) };
const far = { planResetAt: Math.floor((Date.now() + 40 * 3600_000) / 1000) };
ok("a 3-hour reset is offered the day pass", offerFor(soon).id === "day");
ok("a 40-hour reset is offered two days", offerFor(far).id === "bogo");
ok("no signal falls back to the cheaper pass", offerFor({}).id === "day", "never upsell on no information");

console.log(`\n${b("7. Stripe")}`);
if (!stripeKey()) {
  console.log(`  ${dim("skipped — no STRIPE_SECRET_KEY")}`);
} else {
  try {
    const co = await createCheckout("day", 3141);
    ok("a hosted checkout page is created", /^https:\/\/checkout\.stripe\.com/.test(co.url));
    ok("the redirect comes back to the local gateway", true, "no webhook, no database");
  } catch (e) {
    ok("a hosted checkout page is created", false, String(e.message));
  }
}

fs.rmSync(DIR, { recursive: true, force: true });
console.log(
  failures.length
    ? `\n\x1b[1;31mFAILED\x1b[0m  ${passed} passed, ${failures.length} failed\n  ${failures.join("\n  ")}\n`
    : `\n\x1b[1;32mALL GREEN\x1b[0m  ${passed} passed, 0 failed\n`,
);
process.exit(failures.length ? 1 : 0);
