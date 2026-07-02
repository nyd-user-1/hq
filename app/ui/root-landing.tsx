import Hero from "@/app/ui/landing/hero";
import Manifesto from "@/app/ui/landing/manifesto";
import Observe from "@/app/ui/landing/observe";
import Cost from "@/app/ui/landing/cost";
import Control from "@/app/ui/landing/control";
import Scale from "@/app/ui/landing/scale";
import Moat from "@/app/ui/landing/moat";
import Pricing from "@/app/ui/landing/pricing";
import CTA from "@/app/ui/landing/cta";
import Footer from "@/app/ui/landing/footer";

// The "/" face — hq's front door, the hq version of Linear's landing: a clean top
// nav, a hero with a live product shot, a two-tone manifesto over a real "reads"
// strip + FIG figures, then N.0-numbered feature sections whose product shots are
// the actual hq surfaces (the state-colored terminal wall, the live usage/burn +
// spend ledger). Rendered in the product's own vocabulary — dashed boundaries,
// file-path chips, the real turn-state colors. Each section earns its place.
//
// This is the scroll container — the landing owns its own overflow, so the sticky
// nav sticks to the top of the page.
export default function RootLanding() {
  return (
    // #010102 = Linear's --color-bg-marketing, lifted verbatim: the landing's
    // "non-black black" that lets elevated panels (#0f1011+) read as lit.
    <div
      className="scrollbar-none min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-smooth"
      style={{ background: "#010102" }}
    >
      {/* Navbar removed (Brendan, 7/2) — the landing opens straight on the hero;
          landing/nav.tsx kept on disk in case it returns. */}
      <main>
        <Hero />
        <Manifesto />
        <Observe />
        <Cost />
        <Control />
        <Scale />
        <Moat />
        <Pricing />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
