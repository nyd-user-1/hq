"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MetricItem } from "@/lib/fleet";
import { ShapeCard } from "@/app/ui/fleet-view";
import { useInView } from "./use-in-view";

// Parse a formatted stat ("55.3M", "$7.5k", "4,418", "26%", "48") into its animatable
// parts so the number can count up while the prefix/suffix ($, %, M, k…) hold steady.
// Returns null for non-numeric values ("—") — those render verbatim, no count-up.
function parseStat(v: string) {
  const m = v.match(/^(\D*?)([\d,]+(?:\.\d+)?)(\D*)$/);
  if (!m) return null;
  const digits = m[2].replace(/,/g, "");
  const num = parseFloat(digits);
  if (!isFinite(num)) return null;
  const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
  return { prefix: m[1], num, suffix: m[3], decimals, grouped: m[2].includes(",") };
}

function fmtStat(n: number, p: NonNullable<ReturnType<typeof parseStat>>) {
  const body = p.grouped
    ? n.toLocaleString("en-US", { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })
    : n.toFixed(p.decimals);
  return `${p.prefix}${body}${p.suffix}`;
}

// The stat value, counting up 0→target (easeOutCubic, ~0.9s) the first time it scrolls
// into view. Later 8s-poll updates just swap in the new value without re-animating.
function CountUp({ value, className }: { value: string; className?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const parsed = useMemo(() => parseStat(value), [value]);
  const [disp, setDisp] = useState(() => (parsed ? fmtStat(0, parsed) : value));
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) {
      setDisp(value); // post-animation poll update — show latest, don't replay
      return;
    }
    if (!inView || !parsed) return;
    ran.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisp(value);
      return;
    }
    const dur = 900;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      setDisp(fmtStat(parsed.num * e, parsed));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, parsed, value]);

  return (
    <span ref={ref} className={className}>
      {parsed ? disp : value}
    </span>
  );
}

// The fixed board layout for the landing's analytics dashboard section — the
// preferred Analytics view, laid out like the real dashboard but without the
// drag/resize/persist machinery (this is a product shot, not a workspace).
// Cells are the REAL ShapeCard components, so tooltips, the range picker, and
// the rAF path-morph all work. Heights are explicit because the cards fill their
// parent.

// Landing-only stat tile — value-only, larger, three-across (Brendan's live
// devtools edit persisted). The real analytics view keeps the labeled KpiTile.
const TONE: Record<string, string> = {
  green: "text-green-400",
  blue: "text-blue-400",
  orange: "text-orange-400",
  amber: "text-amber-400",
  red: "text-red-400",
  zinc: "text-zinc-50",
};

function ShotStat({ value, label, tone }: { value: string; label?: string; tone?: string }) {
  return (
    <div className="flex h-[52px] items-center justify-between gap-3 rounded-lg border border-zinc-800/70 bg-zinc-900/30 px-5">
      <CountUp value={value} className={`text-[26px] leading-none tracking-tight ${TONE[tone ?? "zinc"] ?? TONE.zinc}`} />
      {label && <span className="shrink-0 text-[11px] uppercase tracking-widest text-zinc-500">{label}</span>}
    </div>
  );
}

export default function DashboardBoard({ items }: { items: MetricItem[] }) {
  const by = new Map(items.map((it) => [it.id, it]));
  const stat = (id: string) => {
    const it = by.get(id);
    return it?.stat ? <ShotStat value={it.stat.value} label={it.stat.label} tone={it.stat.tone} /> : null;
  };
  const shape = (id: string) => {
    const it = by.get(id);
    return it?.shape ? <ShapeCard shape={it.shape} /> : null;
  };
  // Fills the frame exactly — fixed stat row, the two chart rows flex to the
  // remaining height, so the board never scrolls.
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="grid shrink-0 grid-cols-3 gap-3">
        {stat("f_sessions")}
        {stat("f_tokens")}
        {stat("f_turns")}
        {stat("f_projects")}
        {stat("todos_pending")}
        {stat("f_cliff")}
      </div>
      <div className="min-h-0 flex-[1.1]">{shape("tokens_by_session_area")}</div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        {shape("tokens_day_area")}
        {shape("tokens_stacked_area")}
      </div>
    </div>
  );
}
