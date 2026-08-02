import { NextRequest, NextResponse } from "next/server";
import {
  createBackstopCheckout,
  stripeConfigured,
  CREDIT_MIN_USD,
  CREDIT_MAX_USD,
} from "@/lib/stripe";

export const dynamic = "force-dynamic";

// POST { amount } (integer USD) → { url } of a Stripe-hosted Checkout Session.
// The client redirects there; Stripe returns to /checkout/success on payment.
export async function POST(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { amount?: unknown } | null;
  const amount = Number(body?.amount);
  if (!Number.isInteger(amount) || amount < CREDIT_MIN_USD || amount > CREDIT_MAX_USD) {
    return NextResponse.json(
      { error: "bad_amount", min: CREDIT_MIN_USD, max: CREDIT_MAX_USD },
      { status: 400 },
    );
  }
  try {
    const { url } = await createBackstopCheckout(amount, new URL(req.url).origin);
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json(
      { error: "stripe_error", detail: String(e instanceof Error ? e.message : e).slice(0, 300) },
      { status: 502 },
    );
  }
}
