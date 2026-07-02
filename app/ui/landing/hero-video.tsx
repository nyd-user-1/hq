"use client";

import { useEffect, useRef, useState } from "react";

// The hero product shot as a looping screen-recording of hq (1280×720, ~6s, with
// an AAC audio track). It MUST start muted — browsers block autoplay-with-sound
// until the user interacts — so a speaker toggle lets you unmute to hear it.
// Honors prefers-reduced-motion like the rest of the landing: under that setting
// it holds the first frame instead of playing.
export default function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      v.removeAttribute("autoplay");
      v.pause();
      v.currentTime = 0;
      setPaused(true);
    } else {
      // Some browsers need an explicit play() after hydration.
      v.play().catch(() => {});
    }
  }, []);

  const toggleMute = () => {
    const v = ref.current;
    if (!v) return;
    const next = !muted;
    v.muted = next;
    setMuted(next);
    // Unmuting counts as the user gesture; make sure it's actually playing.
    if (!next) v.play().catch(() => {});
  };

  // Click the video itself to pause/play (the speaker button stops propagation
  // so muting doesn't also toggle playback).
  const togglePlay = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  };

  return (
    <div className="relative h-full w-full">
      <video
        ref={ref}
        onClick={togglePlay}
        className="h-full w-full cursor-pointer object-cover"
        src="https://github.com/nyd-user-1/hq/releases/download/assets-v1/hq-short-video.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-label="hq in action — click to pause or play"
      />
      {paused && (
        <div
          aria-hidden
          onClick={togglePlay}
          className="absolute inset-0 flex cursor-pointer items-center justify-center"
        >
          <span
            className="flex size-16 items-center justify-center rounded-full backdrop-blur-md"
            style={{ background: "rgba(1,1,2,0.55)", border: "1px solid #ffffff1f", color: "#f7f8f8" }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleMute();
        }}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute bottom-3 right-3 flex size-8 items-center justify-center rounded-full backdrop-blur-md transition-colors"
        style={{ background: "rgba(1,1,2,0.55)", border: "1px solid #ffffff1f", color: "#f7f8f8" }}
      >
        {muted ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 5 6 9H2v6h4l5 4z" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 5 6 9H2v6h4l5 4z" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        )}
      </button>
    </div>
  );
}
