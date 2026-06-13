"use client";

import { useRouter } from "next/navigation";
import React from "react";

// A back control for inside a parallel-route panel. A plain <Link> that only
// STRIPS a searchParam (e.g. ?commit=) can fail to refetch the slot — the route
// segment is unchanged, so the soft navigation reuses the cached reader instead
// of re-rendering the list. Pushing then calling router.refresh() invalidates
// that cache so the destination re-renders.
export default function BackLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        router.push(href, { scroll: false });
        router.refresh();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
