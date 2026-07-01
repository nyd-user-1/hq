"use client";

import Link from "next/link";

// "Download hq" — sits above New Session. Links to the landing/install page at "/"
// (being redesigned into the download surface). lucide "hard-drive-download".
export default function DownloadHqItem() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
    >
      {/* lucide hard-drive-download */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M12 2v8" />
        <path d="m16 6-4 4-4-4" />
        <rect width="20" height="8" x="2" y="14" rx="2" />
        <path d="M6 18h.01" />
        <path d="M10 18h.01" />
      </svg>
      Download hq
    </Link>
  );
}
