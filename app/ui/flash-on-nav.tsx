"use client";

import { useSelectedLayoutSegment } from "next/navigation";

// Re-key the slot's page on every tab change so freshly mounted boundaries
// replay their blue flash animation, exactly like the demo.
export default function FlashOnNav({
  children,
}: {
  children: React.ReactNode;
}) {
  const segment = useSelectedLayoutSegment();
  return (
    <div key={segment ?? "home"} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {children}
    </div>
  );
}
