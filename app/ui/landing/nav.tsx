import Link from "next/link";
import { Ping } from "./primitives";

const LINKS = [
  { href: "#observe", label: "Product" },
  { href: "#pricing", label: "Pricing" },
  { href: "https://github.com/nyd-user-1/hq", label: "GitHub" },
];

// The top chrome — Linear's landing has one, thin and quiet. hq wordmark + a live
// ping on the left, a few anchors, and a white "Open hq" pill on the right. Sticks
// to the top of the landing scroll container.
export default function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-900/70 bg-zinc-950/70 backdrop-blur-md">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5 sm:px-8">
        <a href="#top" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-100">
          <Ping />
          <span>hq</span>
        </a>
        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a key={l.label} href={l.href} className="text-sm text-zinc-400 transition-colors hover:text-zinc-100">
              {l.label}
            </a>
          ))}
        </div>
        <Link
          href="/?session=new"
          className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200"
        >
          Open hq
        </Link>
      </nav>
    </header>
  );
}
