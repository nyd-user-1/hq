"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// The sidebar's primary action (where "Search" used to sit): start a fresh,
// context-free session. Nothing is spawned — a session only exists once you type
// in a Claude terminal — so this stages the terminal (?session=new), which
// auto-flips to the newborn session the moment its transcript appears.
export default function NewSessionItem() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const staged = useSearchParams().get("session") === "new";
  return (
    <button
      onClick={() => router.push(`${pathname}?session=new`, { scroll: false })}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
        staged
          ? "bg-blue-600 text-white"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      }`}
    >
      {/* lucide Plus */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      New Session
    </button>
  );
}
