"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// A result card that is BOTH a click-to-open link and draggable into a terminal.
// Click → navigates to `href` (open the source in-panel, like a commit→diff).
// Drag → drops `drag` (an absolute path) using the same dataTransfer types the
// terminal's drop handler and the AccordionItem (Components) cards use, so a
// script card behaves exactly like a Component card: drop it on a terminal and
// the path lands in the send box.
const DND_TYPE = "application/x-hq-todo";

export default function DraggableCard({
  href,
  drag,
  className,
  children,
}: {
  href: string;
  drag: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      draggable
      onDragStart={(e) => {
        // Override the anchor's default (drag the href URL) with the file path.
        e.dataTransfer.setData(DND_TYPE, drag);
        e.dataTransfer.setData("text/plain", drag);
        e.dataTransfer.effectAllowed = "copyMove";
      }}
      className={className}
    >
      {children}
    </Link>
  );
}
