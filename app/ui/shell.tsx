"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Boundary from "@/app/ui/boundary";

// Client shell: owns the top-level page tabs (Dashboard / Meters / Buckets)
// after the "Terminal 2" title and decides the layout. The parallel-route slots
// resolve to their default.tsx on the full-width routes; we simply don't place
// them there, so those pages run full-width without any slot-folder surgery.
const FULL_WIDTH = new Set(["/meters", "/buckets"]);

export default function Shell({
  children,
  activity,
  console: consolePanel,
}: {
  children: React.ReactNode;
  activity: React.ReactNode;
  console: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const isFullWidth = FULL_WIDTH.has(pathname);
  const tabs = [
    { title: "Dashboard", href: "/", active: pathname === "/" },
    { title: "Meters", href: "/meters", active: pathname === "/meters" },
    { title: "Buckets", href: "/buckets", active: pathname === "/buckets" },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-5 p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-2 px-1">
        <h1 className="text-lg font-semibold tracking-tight">Agentic OS</h1>
        <nav className="flex gap-2">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                t.active
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
            >
              {t.title}
            </Link>
          ))}
        </nav>
        <p className="ml-auto text-sm text-zinc-500">
          one vault · every project · localhost only
        </p>
      </header>

      {isFullWidth ? (
        children
      ) : (
        <Boundary label="layout.tsx">
          <div className="grid flex-1 items-start gap-5 lg:grid-cols-3">
            <div className="order-2 flex min-w-0 lg:order-1 lg:col-span-2 lg:row-span-2">
              {children}
            </div>
            <div className="order-1 flex min-w-0 lg:order-2">{activity}</div>
            <div className="order-3 flex min-w-0">{consolePanel}</div>
          </div>
        </Boundary>
      )}
    </div>
  );
}
