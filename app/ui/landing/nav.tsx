import Link from "next/link";
import { Ping } from "./primitives";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#interface", label: "Interface" },
  { href: "#inside", label: "Inside" },
  { href: "#pricing", label: "Pricing" },
];

// Sticky top chrome. Sticks to the top of the landing scroll container (the landing
// owns the scroll, not the window), stays quiet — translucent, hairline, mono.
export default function LandingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-900/80 bg-zinc-950/70 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
        <a href="#top" className="flex items-center gap-2 font-mono text-sm text-zinc-200">
          <Ping /> hq
        </a>
        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-100"
            >
              {l.label}
            </a>
          ))}
        </div>
        <Link
          href="/?session=new"
          className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3.5 py-1.5 font-mono text-xs text-blue-200 transition-colors hover:bg-blue-500/20"
        >
          Open hq →
        </Link>
      </nav>
    </header>
  );
}
