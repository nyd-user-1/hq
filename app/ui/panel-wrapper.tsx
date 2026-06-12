"use client";

import { usePathname, useRouter } from "next/navigation";
import AppPanel from "@/app/ui/app-panel";
import { PANEL_ROUTES } from "@/app/ui/sidebar-nav";

// Reads the URL to decide whether the right panel is open, and renders the
// `panel` parallel-route slot inside AppPanel. Closing pushes to "/", whose
// @panel/default.tsx is null. The terminal (in the layout) never remounts.
export default function PanelWrapper({ panel }: { panel: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const open = PANEL_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );

  return (
    <AppPanel open={open} onClose={() => router.push("/", { scroll: false })}>
      {panel}
    </AppPanel>
  );
}
