"use client";

import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { withPins } from "@/app/ui/keep-pins";

// The back affordance for the Metrics drill-down: on the hub (/metrics) it
// renders nothing; on a drilled section it shows "‹ back · <Section>". Mirrors
// BackLink (push + refresh to invalidate the slot's cached reader) and carries
// the terminal pins so back-nav never re-pins / snaps the panel.
const TITLES: Record<string, string> = {
  usage: "Usage",
  calls: "Calls",
  guardrails: "Guardrails",
  savings: "Savings",
  audit: "Memory Audit",
};

export default function MetricsBackBar() {
  const router = useRouter();
  const seg = useSelectedLayoutSegment();
  if (!seg || seg === "metrics") return null; // on the hub → no back bar

  return (
    <nav className="flex items-center gap-2 pb-3.5">
      <button
        type="button"
        onClick={() => {
          router.push(withPins("/metrics", window.location.search), { scroll: false });
          router.refresh();
        }}
        className="flex items-center gap-1 text-xs font-medium text-blue-400 transition-colors hover:text-blue-300"
      >
        ‹ back
      </button>
      <span className="text-xs text-zinc-600">/</span>
      <span className="text-xs font-medium text-zinc-300">{TITLES[seg] ?? seg}</span>
    </nav>
  );
}
