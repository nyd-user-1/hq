import LandingInstall from "@/app/ui/landing-install";

export const dynamic = "force-dynamic";

// Standalone preview of HQ's DEPLOYED landing/install surface. A fixed,
// full-screen overlay so it reads as its own page regardless of the always-on
// shell columns rendering behind it (the terminal stays mounted, just hidden).
// Visit /install on the local dev server to see exactly what a Vercel deploy
// will show once the deployed-state detection is wired into the shell.
export default function InstallPreviewPage() {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950">
      <LandingInstall />
    </div>
  );
}
