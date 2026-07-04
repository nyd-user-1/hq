"use client";

import { useEffect, useState } from "react";
import { useInView } from "./use-in-view";

// A usage meter whose fill sweeps left→right the moment it scrolls into view. The
// width tweens 0→pct via a CSS transition (kicked one frame after the bar enters the
// viewport). Respects prefers-reduced-motion (snaps to pct, no sweep).
export function MeterBar({ pct, color, className = "" }: { pct: number; color: string; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [w, setW] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setW(pct);
      return;
    }
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [inView, pct]);

  return (
    <div ref={ref} className={`h-2.5 w-full overflow-hidden rounded-full bg-zinc-800 ${className}`}>
      <div
        className="h-full origin-left rounded-full"
        style={{
          width: `${pct}%`,
          background: color,
          transform: `scaleX(${w ? 1 : 0})`,
          transition: "transform 0.9s cubic-bezier(0.16,1,0.3,1)",
        }}
      />
    </div>
  );
}
