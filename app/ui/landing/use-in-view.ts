"use client";

import { useEffect, useRef, useState } from "react";

// Fire once when an element scrolls into view — the shared trigger behind the
// landing's count-ups and meter fills. One IntersectionObserver, disconnected after
// the first hit (so the animation plays when the viewer actually reaches it, not on a
// far-offscreen mount). Same -80px bottom inset as <Reveal>.
export function useInView<T extends HTMLElement>(rootMargin = "0px 0px -80px 0px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return [ref, inView] as const;
}
