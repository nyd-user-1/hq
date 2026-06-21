"use client";

import { useRouter } from "next/navigation";
import { withPins } from "@/app/ui/keep-pins";

// The Metrics panel's landing — a drill-down index. Each row routes into one
// section; the (metrics) layout shows a "‹ back" to here once you're inside.
// Pins (?session/?pair) are carried on every push (same rule as TabNav) so
// drilling never re-pins the terminal / snaps the panel back.
const ITEMS: { href: string; title: string; sub: string }[] = [
  { href: "/usage", title: "Usage", sub: "rate-limits · token burn · forecast" },
  { href: "/calls", title: "Calls", sub: "$ per-call ledger" },
  { href: "/guardrails", title: "Guardrails", sub: "budget caps · burn-rate alerts" },
];

function Chevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export default function MetricsHub() {
  const router = useRouter();
  return (
    <div className="flex flex-col">
      {ITEMS.map((it, i) => (
        <button
          key={it.href}
          type="button"
          onClick={() =>
            router.push(withPins(it.href, window.location.search), { scroll: false })
          }
          className={`group flex items-center justify-between gap-3 rounded-md px-2 py-4 text-left transition-colors hover:bg-zinc-900 ${
            i > 0 ? "border-t border-zinc-800" : ""
          }`}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-zinc-200 transition-colors group-hover:text-white">
              {it.title}
            </span>
            <span className="truncate font-mono text-[11px] text-zinc-500">{it.sub}</span>
          </span>
          <span className="text-zinc-600 transition-all group-hover:translate-x-0.5 group-hover:text-zinc-300">
            <Chevron />
          </span>
        </button>
      ))}
    </div>
  );
}
