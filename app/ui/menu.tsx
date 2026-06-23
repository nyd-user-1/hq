"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// Anchored dropdown menu — the outside-click / Escape / scroll-dismiss pattern
// that 9 files (todo-menu, block-menu, account-chip, components-list, …) each
// hand-rolled. Portaled + fixed off the trigger so a scroll container can't clip
// it. Wrap MenuItem rows as children; choosing one runs its handler then closes.

const MenuCloseCtx = createContext<() => void>(() => {});

export function MenuItem({
  icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon?: ReactNode;
  label: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  const close = useContext(MenuCloseCtx);
  return (
    <button
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
        close();
      }}
      className={`flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-1 ${
        danger ? "text-danger" : active ? "text-yellow-300" : "text-zinc-300"
      }`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {label}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />;
}

export default function Menu({
  trigger,
  children,
  label = "Open menu",
  align = "right",
  width = "w-44",
  triggerClassName = "",
  menuClassName = "",
}: {
  trigger: ReactNode;
  children: ReactNode;
  label?: string;
  align?: "left" | "right";
  width?: string;
  triggerClassName?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on any outside click, Escape, or scroll — matches the block/sidebar kebab.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      setPos(
        align === "right"
          ? { top: r.bottom + 4, right: window.innerWidth - r.right }
          : { top: r.bottom + 4, left: r.left },
      );
    }
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <MenuCloseCtx.Provider value={() => setOpen(false)}>
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              style={{ top: pos.top, left: pos.left, right: pos.right }}
              className={`fixed z-50 flex ${width} flex-col whitespace-nowrap rounded-md border border-line bg-surface-0 p-1 shadow-xl ${menuClassName}`}
            >
              {children}
            </div>
          </MenuCloseCtx.Provider>,
          document.body,
        )}
    </>
  );
}
