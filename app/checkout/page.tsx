import LandingCheckout from "@/app/ui/landing-checkout";

export const dynamic = "force-dynamic";

// The purchase surface — backstop credit. Same standalone-overlay pattern as
// /install: a fixed, full-screen layer over the always-on shell columns (the
// terminal stays mounted underneath, just hidden).
export default function CheckoutPage() {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950">
      <LandingCheckout />
    </div>
  );
}
