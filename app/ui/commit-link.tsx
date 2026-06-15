"use client";

import { useRouter } from "next/navigation";
import { withPins } from "@/app/ui/keep-pins";

// A commit-sha chip inside a chat reply that opens the diff in the Shipped panel.
// Carries the terminal pins (?session/?pair) at click time — without them the
// terminal re-pins and wipes ?commit (the diff opens then snaps back). Client so
// it can read window.location.search; md.tsx renders these for sha tokens.
export default function CommitLink({ sha }: { sha: string }) {
  const router = useRouter();
  const href = `/shipped?commit=${sha}`;
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        router.push(withPins(href, window.location.search), { scroll: false });
      }}
      className="cursor-pointer rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.95em] text-blue-400 transition-colors hover:bg-zinc-700 hover:text-blue-300"
    >
      {sha}
    </a>
  );
}
