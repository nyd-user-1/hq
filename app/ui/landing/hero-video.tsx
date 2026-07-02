"use client";

import { useEffect, useRef } from "react";

// The hero product shot as a looping silent screen-recording of hq (1280×720,
// ~6s). Autoplay needs muted + playsInline or browsers block it; loop keeps it
// running. Honors prefers-reduced-motion like the rest of the landing — under
// that setting it holds the first frame instead of playing.
export default function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      v.removeAttribute("autoplay");
      v.pause();
      v.currentTime = 0;
    } else {
      // Some browsers need an explicit play() after hydration.
      v.play().catch(() => {});
    }
  }, []);

  return (
    <video
      ref={ref}
      className="h-full w-full object-cover"
      src="/hq-short-video.mp4"
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-label="hq in action — a live session on the wall"
    />
  );
}
