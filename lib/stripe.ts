// Stripe over plain fetch — no SDK, so the 3-runtime-dep rule holds (the same
// zero-dep stance as backstop's SigV4). Server-only. Checkout Sessions is the
// integration surface: Stripe hosts the payment page, card data never touches
// hq. Keys: `stripe sandbox create` for test, a Vercel env for live; absent key
// = payments-not-configured, surfaced honestly in the UI rather than faked.

const API = "https://api.stripe.com/v1";
// Pin the version the integration is written against, not the account default.
const VERSION = "2026-07-29.dahlia";
// Dashboard label for this checkout flow (stable name + required random suffix).
const INTEGRATION_ID = "hq_backstop_checkout_wvqkzmtr";

export { CREDIT_MIN_USD, CREDIT_MAX_USD, CREDIT_PRESETS_USD } from "./credit";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

async function stripeCall(
  path: string,
  form?: Record<string, string>,
): Promise<Record<string, unknown>> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetch(`${API}${path}`, {
    method: form ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": VERSION,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(form ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
    cache: "no-store",
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(err?.message ?? `Stripe ${res.status} on ${path}`);
  }
  return json;
}

// Create a hosted Checkout Session for a one-time backstop-credit purchase.
// No payment_method_types (dynamic payment methods stay on); no automatic_tax
// (requires an active tax registration first).
export async function createBackstopCheckout(
  amountUsd: number,
  origin: string,
): Promise<{ url: string }> {
  const s = await stripeCall("/checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amountUsd * 100),
    "line_items[0][price_data][product_data][name]": "hq backstop credit",
    "line_items[0][price_data][product_data][description]":
      "Prepaid API capacity for /backstop — drawn down at provider list price.",
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout`,
    "metadata[kind]": "backstop_credit",
    "metadata[credit_usd]": String(amountUsd),
    integration_identifier: INTEGRATION_ID,
  });
  if (typeof s.url !== "string") throw new Error("Checkout Session has no url");
  return { url: s.url };
}

export type CheckoutResult = {
  paid: boolean;
  status: string;
  amountUsd: number | null;
  email: string | null;
};

// Retrieve a session for the success page — server-side, so the rendered
// "payment received" is a Stripe fact, not a trusted query param.
export async function getCheckoutSession(id: string): Promise<CheckoutResult> {
  const s = await stripeCall(`/checkout/sessions/${encodeURIComponent(id)}`);
  const details = s.customer_details as { email?: string } | null;
  return {
    paid: s.payment_status === "paid",
    status: String(s.status ?? "unknown"),
    amountUsd: typeof s.amount_total === "number" ? s.amount_total / 100 : null,
    email: details?.email ?? null,
  };
}
