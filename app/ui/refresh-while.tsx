"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-render the server component on an interval while `active` (e.g. the search
// index is building for the first time), so freshly-indexed results appear
// without the user re-typing. Stops as soon as `active` goes false.
export default function RefreshWhile({
  active,
  ms = 2500,
}: {
  active: boolean;
  ms?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return null;
}
