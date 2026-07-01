import Hero from "@/app/ui/landing/hero";
import Problem from "@/app/ui/landing/problem";
import Insight from "@/app/ui/landing/insight";
import HowItWorks from "@/app/ui/landing/how-it-works";
import StateSystem from "@/app/ui/landing/state-system";
import Features from "@/app/ui/landing/features";
import Control from "@/app/ui/landing/control";
import Moat from "@/app/ui/landing/moat";
import Market from "@/app/ui/landing/market";
import Pricing from "@/app/ui/landing/pricing";
import CTA from "@/app/ui/landing/cta";
import Footer from "@/app/ui/landing/footer";

// The "/" face — hq's front door. A cohesive scrolling landing page composed from
// the parts in app/ui/landing/*, rendered in the product's own design vocabulary.
// (The working sessions index + terminal live on the "New Session" button /
// ?session=new; Terminal1Slot intercepts root before <Terminal> mounts.)
//
// This is the scroll container — the landing owns its own overflow, so the sticky
// nav sticks to the top of the page, not the window.
export default function RootLanding() {
  return (
    <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-smooth bg-zinc-950">
      <main>
        <Hero />
        <Problem />
        <Insight />
        <HowItWorks />
        <StateSystem />
        <Features />
        <Control />
        <Moat />
        <Market />
        <Pricing />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
