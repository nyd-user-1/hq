"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

export type Tab = {
  title: string;
  href: string;
  /** Segment this tab matches inside its slot; null = the slot's index page */
  segment: string | null;
};

export default function TabNav({ tabs }: { tabs: Tab[] }) {
  const active = useSelectedLayoutSegment();
  return (
    <nav className="flex gap-2">
      {tabs.map((tab) => {
        const isActive = active === tab.segment;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              isActive
                ? "bg-zinc-100 text-zinc-900"
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
