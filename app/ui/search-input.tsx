"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// Search-as-you-type: debounce keystrokes into router.replace so the server
// page re-runs the search while the input (client state) keeps focus and value.
// Enter just flushes the debounce immediately.
export default function SearchInput({
  initial,
  scope,
}: {
  initial: string;
  scope: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = (q: string) =>
    router.replace(`/search?q=${encodeURIComponent(q)}&scope=${scope}`, {
      scroll: false,
    });

  return (
    <input
      type="search"
      name="q"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => go(v), 250);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (timer.current) clearTimeout(timer.current);
          go(value);
        }
      }}
      placeholder="search transcripts + memory…"
      autoComplete="off"
      className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
    />
  );
}
