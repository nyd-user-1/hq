"use client";

import { useState } from "react";
import Link from "next/link";
import { CREDIT_MIN_USD, CREDIT_MAX_USD, CREDIT_PRESETS_USD } from "@/lib/credit";

// The DEPLOYED purchase surface (rendered at /checkout). hq itself is free and
// open-source — what you buy is backstop credit: prepaid API capacity that
// /backstop draws down when Claude Code hits its usage wall. The page tells that
// story in hq's own vocabulary (the wall vignette uses the real turn-state
// colors), takes an amount, and hands off to Stripe-hosted Checkout — card data
// never touches hq. No key configured = the honest not-configured state.

// The /backstop moment, as a static pane in the terminal's visual language:
// orange = the walled state, blue = the user's move, emerald = resumed.
function WallVignette() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 font-mono text-xs leading-relaxed">
      <div className="flex items-center gap-2 text-zinc-500">
        <span className="text-[#f97316]">●</span>
        terminal-1 · opus · ctx 41%
      </div>
      <p className="mt-2 text-zinc-400">
        You&apos;ve reached your usage limit · resets 3am
      </p>
      <p className="mt-3 text-zinc-100">
        <span className="select-none text-zinc-600">&gt; </span>/backstop
      </p>
      <div className="mt-3 flex items-center gap-2 text-emerald-400">
        <span>●</span>
        backstop on — every session resumed in place
      </div>
      <p className="mt-1 pl-4 text-zinc-500">
        same processes, same transcripts · metered to ~/.claude/hq/backstop.jsonl
      </p>
    </div>
  );
}

function AmountButton({
  usd,
  active,
  onPick,
}: {
  usd: number;
  active: boolean;
  onPick: (usd: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(usd)}
      className={`rounded-lg border px-5 py-3 font-mono text-sm transition-colors ${
        active
          ? "border-blue-600 bg-blue-600/10 text-zinc-50"
          : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600"
      }`}
    >
      ${usd}
    </button>
  );
}

function CheckoutForm() {
  const [amount, setAmount] = useState<number>(CREDIT_PRESETS_USD[1]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effective = custom === "" ? amount : Number(custom);
  const valid =
    Number.isInteger(effective) && effective >= CREDIT_MIN_USD && effective <= CREDIT_MAX_USD;

  async function pay() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: effective }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (res.ok && json.url) {
        window.location.assign(json.url);
        return; // keep busy=true through the redirect
      }
      setError(
        json.error === "payments_not_configured"
          ? "payments not configured — STRIPE_SECRET_KEY is unset on this deploy"
          : json.error === "bad_amount"
            ? `amount must be a whole $${CREDIT_MIN_USD}–$${CREDIT_MAX_USD}`
            : `checkout failed — ${json.error ?? res.status}`,
      );
    } catch {
      setError("checkout failed — network error");
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {CREDIT_PRESETS_USD.map((usd) => (
          <AmountButton
            key={usd}
            usd={usd}
            active={custom === "" && amount === usd}
            onPick={(v) => {
              setAmount(v);
              setCustom("");
            }}
          />
        ))}
        <label
          className={`flex items-center gap-1.5 rounded-lg border px-4 py-3 font-mono text-sm transition-colors ${
            custom !== ""
              ? "border-blue-600 bg-blue-600/10 text-zinc-50"
              : "border-zinc-800 bg-zinc-900/40 text-zinc-500 focus-within:border-zinc-600"
          }`}
        >
          $
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="custom"
            inputMode="numeric"
            size={6}
            className="bg-transparent text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </label>
      </div>

      <p className="mt-3 font-mono text-xs text-zinc-500">
        1 credit = $1 of API capacity · drawn down at provider list price · whole $
        {CREDIT_MIN_USD}–${CREDIT_MAX_USD}
      </p>

      <button
        type="button"
        onClick={pay}
        disabled={!valid || busy}
        className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-10"
      >
        {busy ? "Opening Stripe checkout…" : `Buy $${valid ? effective : "—"} backstop credit`}
      </button>

      {error && (
        <p className="mt-3 rounded-md border border-dashed border-red-900 bg-red-950/40 px-3 py-2 font-mono text-xs text-red-400">
          {error}
        </p>
      )}

      <p className="mt-6 font-mono text-xs text-zinc-600">
        Stripe-hosted checkout · card details never touch hq · receipt to your email
      </p>
    </div>
  );
}

const FACTS: [string, string][] = [
  ["One command", "at the wall, type /backstop in any session — all of them resume in place"],
  ["No fork", "the same live processes reroute; one transcript, nothing restarts"],
  ["Metered honestly", "drawdown at provider list price, ledgered locally, itemized per call"],
  ["Off is off", "/backstop off returns you home; passthrough is never metered or logged"],
];

export default function LandingCheckout() {
  return (
    <div className="relative min-h-full w-full overflow-y-auto bg-zinc-950 text-zinc-100">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(37,99,235,0.10),transparent)]" />
      <div className="relative mx-auto max-w-3xl px-6 py-16 sm:py-24">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 font-mono text-sm tracking-wide text-zinc-400">
            <span className="text-blue-500">●</span>
            hq — backstop credit
          </div>
          <Link
            href="/"
            className="font-mono text-xs text-zinc-600 transition-colors hover:text-zinc-300"
          >
            ← back to hq
          </Link>
        </div>

        <h1 className="mt-6 bg-gradient-to-br from-white to-zinc-400 bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-[2.6rem] sm:leading-[1.1]">
          Keep working past the wall.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-zinc-400">
          hq is free and open-source. Backstop credit is prepaid API capacity: when
          Claude&nbsp;Code hits its usage limit, <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-base text-zinc-200">/backstop</code>{" "}
          reroutes your live sessions onto it — and draws it down only while you&apos;re
          backstopped.
        </p>

        <section className="mt-10">
          <WallVignette />
        </section>

        <section className="mt-14">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Buy credit
          </h2>
          <div className="mt-5">
            <CheckoutForm />
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            How it draws down
          </h2>
          <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {FACTS.map(([name, desc]) => (
              <div key={name} className="flex gap-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-600" />
                <p className="text-sm leading-relaxed text-zinc-400">
                  <span className="text-zinc-200">{name}</span> — {desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-16 border-t border-zinc-900 pt-6 font-mono text-xs text-zinc-600">
          Credit binds to your receipt email. Not ready to buy? hq runs free, forever —{" "}
          <Link href="/install" className="text-zinc-400 transition-colors hover:text-zinc-200">
            install it →
          </Link>
        </footer>
      </div>
    </div>
  );
}
