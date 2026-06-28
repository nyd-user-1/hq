"use client";

import { useChangelog } from "@/app/ui/changelog-state";

// A commit-sha chip inside a chat reply that opens the diff in the Changelog panel.
// It calls openAt(sha) — pure client state, no URL nav — so (unlike the old Shipped
// route link) there are NO terminal pins to carry and nothing to snap back. The
// panel resolves the repo from the sha (findCommit). md.tsx renders these for sha
// tokens.
export default function CommitLink({ sha }: { sha: string }) {
  const { openAt } = useChangelog();
  return (
    <button
      type="button"
      onClick={() => openAt(sha)}
      className="cursor-pointer rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.95em] text-blue-400 transition-colors hover:bg-zinc-700 hover:text-blue-300"
    >
      {sha}
    </button>
  );
}
