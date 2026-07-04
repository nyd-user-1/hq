"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Scroll-into-view reveal — fade + slide-up as each section enters the viewport,
// fired once. A vanilla IntersectionObserver stand-in for the framer-motion <Reveal>
// used on the tariffs / resume landings; hq keeps its runtime deps to three
// (next/react/react-dom), so no framer-motion. Same feel: opacity 0→1, y 18→0, a 0.7s
// [0.16,1,0.3,1] ease. Respects prefers-reduced-motion (reveals instantly, no motion).
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -80px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const ease = "cubic-bezier(0.16,1,0.3,1)";
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(18px)",
        transition: `opacity 0.7s ${ease} ${delay}s, transform 0.7s ${ease} ${delay}s`,
        willChange: shown ? undefined : "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
