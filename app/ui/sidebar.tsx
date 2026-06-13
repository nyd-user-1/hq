"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SIDEBAR_NAV } from "@/app/ui/sidebar-nav";

// Left rail. Brand → "/" (closes the panel, terminal-only). Each item navigates
// the right panel by URL; active = current pathname. Client so the active state
// updates without remounting the layout-mounted terminal.
export default function Sidebar() {
  const pathname = usePathname() ?? "/";

  return (
    <div className="scrollbar-none flex h-full flex-col gap-5 overflow-y-auto">
      <Link href="/" scroll={false} className="block">
        <h1 className="text-base font-semibold tracking-tight">Agentic OS</h1>
      </Link>

      {SIDEBAR_NAV.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          {group.label && (
            <span className="px-2.5 pb-1 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
              {group.label}
            </span>
          )}
          {group.items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                scroll={false}
                className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-blue-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                }`}
              >
                {item.title}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
