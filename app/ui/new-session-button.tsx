"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// The "+" after the TERMINAL.TSX chip: stage a brand-new, context-free
// session. Nothing is spawned — a session only exists once you type in a
// Claude terminal — so this pins the terminal to a staging view that
// auto-flips to the newborn session the moment its file appears.
export default function NewSessionButton() {
  const router = useRouter();
  const pathname = usePathname();
  const staged = useSearchParams().get("session") === "new";
  return (
    <button
      onClick={() => router.push(`${pathname}?session=new`, { scroll: false })}
      title="new session — fresh, context-free start"
      className={`boundary-flash-chip cursor-pointer px-2 py-0.5 font-mono text-[10px] tracking-widest transition-colors ${
        staged
          ? "bg-zinc-700 text-zinc-200"
          : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
      }`}
    >
      +
    </button>
  );
}
