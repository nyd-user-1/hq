import Hero from "@/app/ui/landing/hero";
import DashboardSection from "@/app/ui/landing/dashboard-section";
import Manifesto from "@/app/ui/landing/manifesto";
import Observe from "@/app/ui/landing/observe";
import Cost from "@/app/ui/landing/cost";
import Control from "@/app/ui/landing/control";
import Moat from "@/app/ui/landing/moat";
import Pricing from "@/app/ui/landing/pricing";
import Footer from "@/app/ui/landing/footer";
import { Reveal } from "@/app/ui/landing/reveal";

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
    // #09090b = zinc-950, matched to the app shell (layout.tsx body) and the
    // frame chrome (#090a0b) so the landing fill reads as ONE black with the rest
    // of hq — not a darker "marketing black" inset (was #010102, too dark against
    // the shell). Panels still read as lit via their inner #101112/#121314 layers.
    <div
      className="scrollbar-none min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-smooth"
      style={{ background: "#09090b" }}
    >
      {/* Navbar removed — the landing opens straight on the hero;
          landing/nav.tsx kept on disk in case it returns. */}
      <main>
        <Hero />
        <Reveal><DashboardSection /></Reveal>
        <Reveal><Manifesto /></Reveal>
        <Reveal><Observe /></Reveal>
        <Reveal><Cost /></Reveal>
        <Reveal><Control /></Reveal>
        <Reveal><Moat /></Reveal>
        {/* Remounted for the checkout mission (was built 7/1, dropped in a later
            restructure): the purchase entry point — middle tier → /checkout. */}
        <Reveal><Pricing /></Reveal>
      </main>
      <Footer />
    </div>
  );
}
