"use client";

import { Fragment, Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SIDEBAR_NAV } from "@/app/ui/sidebar-nav";
import SidebarRecents from "@/app/ui/sidebar-recents";

// Disclosure chevron: points down when the group is open, right when collapsed.
function Chevron() {
  return (
    <svg
      className="size-3.5 shrink-0 -rotate-90 text-zinc-600 transition-transform group-[[open]]:rotate-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// Left rail (shadcn-style). Brand → "/" (closes the panel, terminal-only focus).
// Standalone items (Search) sit at the top; each labeled group is a collapsible
// parent whose sub-items navigate the right panel by URL. Recent Sessions
// (Claude-style) fill the bottom. Client so active state updates without
// remounting the layout-mounted terminal.
export default function Sidebar() {
  const pathname = usePathname() ?? "/";
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <Link href="/" scroll={false} className="block shrink-0">
        <h1 className="text-base font-semibold tracking-tight">Agentic OS</h1>
      </Link>

      <nav className="flex shrink-0 flex-col gap-1">
        {SIDEBAR_NAV.map((group) =>
          group.label === "" ? (
            <Fragment key="standalone">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  scroll={false}
                  className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    isActive(item.href)
                      ? "bg-blue-600 text-white"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  }`}
                >
                  {item.title}
                </Link>
              ))}
            </Fragment>
          ) : (
            <details key={group.label} open className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-300 transition-colors marker:content-none hover:bg-zinc-800">
                <span>{group.label}</span>
                <Chevron />
              </summary>
              <div className="ml-3.5 mt-0.5 flex flex-col gap-0.5 border-l border-zinc-800 pl-2.5">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    scroll={false}
                    className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      isActive(item.href)
                        ? "bg-blue-600 text-white"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    }`}
                  >
                    {item.title}
                  </Link>
                ))}
              </div>
            </details>
          )
        )}
      </nav>

      {/* Recent Sessions (Claude-style) — takes the remaining height and scrolls */}
      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <span className="px-2.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          Recent Sessions
        </span>
        <Suspense fallback={null}>
          <SidebarRecents />
        </Suspense>
      </div>
    </div>
  );
}
