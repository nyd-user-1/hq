"use client";

import { useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { reorderPanes } from "@/app/ui/terminals";

// Hears the "hq:reorder-pane" event a terminal's boundary chip dispatches on drop
// and rewrites ?session/?wall to the new order. Kept separate from the (shared,
// widely-used) BoundaryChip so that chip never has to call useSearchParams — only
// this one, mounted once under a Suspense boundary in the shell. Renders nothing.
export default function ReorderListener() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  useEffect(() => {
    const onReorder = (e: Event) => {
      const d = (e as CustomEvent<{ from: number; to: number }>).detail;
      if (!d) return;
      const sp = reorderPanes(params, d.from, d.to);
      const q = sp.toString();
      router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
    };
    window.addEventListener("hq:reorder-pane", onReorder);
    return () => window.removeEventListener("hq:reorder-pane", onReorder);
  }, [params, pathname, router]);
  return null;
}
