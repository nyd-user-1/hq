"use client";

import Link from "next/link";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { withPins } from "@/app/ui/keep-pins";

export type Tab = {
  title: string;
  href: string;
  /** Segment this tab matches inside its slot; null = the slot's index page */
  segment: string | null;
};

export default function TabNav({ tabs }: { tabs: Tab[] }) {
  const router = useRouter();
  const active = useSelectedLayoutSegment();
  return (
    <nav className="mb-2 flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const isActive = active === tab.segment;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            // Carry the terminal pins (?session/?pair) across tab nav, the same
            // way panel open/close and the search trigger do — otherwise
            // switching tabs drops ?pair and unmounts Terminal 2.
            onClick={(e) => {
              e.preventDefault();
              router.push(withPins(tab.href, window.location.search), {
                scroll: false,
              });
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
          >
            {tab.title}
          </Link>
        );
      })}
    </nav>
  );
}
