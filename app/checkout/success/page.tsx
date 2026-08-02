import Link from "next/link";
import { InstallCard } from "@/app/ui/landing-install";
import { getCheckoutSession, stripeConfigured, type CheckoutResult } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// Stripe returns here after checkout. The session is retrieved server-side so
// "payment received" is a Stripe fact, not a trusted query param. Fulfillment
// truth today: the payment lives in Stripe (receipt to the buyer's email) and
// credit binds to that email — redemption inside the backstop gateway is the
// next build, so this page promises nothing beyond what exists.
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  let result: CheckoutResult | null = null;
  let lookupFailed = false;
  if (session_id && stripeConfigured()) {
    try {
      result = await getCheckoutSession(session_id);
    } catch {
      lookupFailed = true;
    }
  }

  const paid = result?.paid ?? false;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(16,185,129,0.10),transparent)]" />
      <div className="relative mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <div className="flex items-center gap-2.5 font-mono text-sm tracking-wide text-zinc-400">
          <span className={paid ? "text-emerald-400" : "text-zinc-600"}>●</span>
          hq — backstop credit
        </div>

        {paid ? (
          <>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-[2.6rem] sm:leading-[1.1]">
              Payment received.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-zinc-400">
              {result?.amountUsd != null && (
                <>
                  <span className="text-zinc-100">${result.amountUsd}</span> of backstop
                  credit
                </>
              )}
              {result?.email ? (
                <>
                  {" "}
                  is bound to <span className="text-zinc-100">{result.email}</span> — your
                  Stripe receipt is on its way there. Keep it: redemption attaches to that
                  email.
                </>
              ) : (
                <> is confirmed — your Stripe receipt is on its way by email.</>
              )}
            </p>

            <div className="mt-10 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-4 font-mono text-xs leading-relaxed text-zinc-400">
              <p>
                <span className="text-emerald-400">● </span>
                Next time Claude Code hits its usage wall, type{" "}
                <span className="text-zinc-100">/backstop</span> in any session — every live
                session resumes in place, metered against your credit.{" "}
                <span className="text-zinc-100">/backstop off</span> returns you home.
              </p>
            </div>

            <section className="mt-14 border-t border-zinc-900">
              <InstallCard />
            </section>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-[2.6rem] sm:leading-[1.1]">
              {lookupFailed || !session_id ? "No completed payment found." : "Checkout not completed."}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-zinc-400">
              {lookupFailed
                ? "The payment reference could not be verified. If your card was charged, the Stripe receipt in your email is the source of truth."
                : "No charge was made. You can pick an amount and try again."}
            </p>
            <Link
              href="/checkout"
              className="mt-8 inline-block rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              Back to checkout
            </Link>
          </>
        )}

        <footer className="mt-16 border-t border-zinc-900 pt-6 font-mono text-xs text-zinc-600">
          <Link href="/" className="transition-colors hover:text-zinc-300">
            ← back to hq
          </Link>
        </footer>
      </div>
    </div>
  );
}
