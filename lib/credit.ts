// Backstop-credit bounds — shared by the server Stripe integration (lib/stripe.ts)
// and the client checkout form. Isomorphic on purpose: keep lib/stripe.ts (env,
// fetch to Stripe) out of the client bundle.
// 1 credit = $1 of API capacity, drawn down at provider list price by the
// backstop gateway (ledger: ~/.claude/hq/backstop.jsonl).
export const CREDIT_MIN_USD = 5;
export const CREDIT_MAX_USD = 500;
export const CREDIT_PRESETS_USD = [25, 50, 100];
