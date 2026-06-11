import CollapsibleBoundary from "@/app/ui/collapsible-boundary";
import TokenMeter from "@/app/ui/token-meter";

export const dynamic = "force-dynamic";

// Token Burn Log (vault note) removed 2026-06-11 — may return later.
export default function Usage() {
  return (
    <CollapsibleBoundary
      label="@activity/usage/page.tsx"
      head={<TokenMeter part="head" />}
    >
      <TokenMeter part="rest" />
    </CollapsibleBoundary>
  );
}
