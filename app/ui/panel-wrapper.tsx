"use client";

import { usePathname, useRouter } from "next/navigation";
import AppPanel from "@/app/ui/app-panel";
import { PANEL_ROUTES } from "@/app/ui/panel-nav";
import { withPins } from "@/app/ui/keep-pins";

// Reads the URL to decide whether the right panel is open, and renders the
// `panel` parallel-route slot inside AppPanel. Closing pushes to "/" (whose
// @panel/default.tsx is null) but KEEPS the terminal pins so it never closes
// Terminal 2 or resets Terminal 1. The terminal (in the layout) never remounts.
export default function PanelWrapper({ panel }: { panel: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const open = PANEL_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );

  return (
    <AppPanel
      open={open}
      onClose={() => router.push(withPins("/", window.location.search), { scroll: false })}
    >
      {panel}
    </AppPanel>
  );
}
