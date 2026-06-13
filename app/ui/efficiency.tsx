"use client";

import { useEffect, useState } from "react";
import { fmtUSD } from "@/lib/pricing";

// Efficiency Mode — a toggle-able money conscience for the displayed session.
// OFF by default and invisible: nothing but a dim toggle. ON: a quiet readout of
// what staying past the 200k cliff is costing ("bleed") and what compactions are
// saving. It NEVER alters the session (HQ can't compact a live session from
// outside) — pure measurement, so flipping it on can't disrupt your work.
type Eff = {
  contextTokens: number;
  pastCliff: boolean;
  premiumPerTurn: number;
  bledTotal: number;
  compactionCount: number;
  trimmedTokens: number;
  savedPerTurn: number;
};
const KEY = "hq:efficiency";

function fmtTok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : `${Math.round(n)}`;
}

export default function Efficiency({ sessionId }: { sessionId: string | null }) {
  const [on, setOn] = useState(false);
  const [data, setData] = useState<Eff | null>(null);

  useEffect(() => {
    setOn(localStorage.getItem(KEY) === "on");
  }, []);

  useEffect(() => {
    if (!on) {
      setData(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const q = sessionId && sessionId !== "new" ? `?session=${sessionId}` : "";
        const d = await (await fetch(`/api/efficiency${q}`)).json();
        if (alive) setData(d);
      } catch {
        // transient — next tick retries
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [on, sessionId]);

  const toggle = () => {
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // storage disabled
    }
  };

  // OFF → just the dim toggle (invisible mode, nothing else).
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
      <button
        onClick={toggle}
        className={`rounded px-1.5 py-0.5 transition-colors ${
          on
            ? "bg-emerald-500/15 text-emerald-300"
            : "bg-zinc-800 text-zinc-600 hover:text-zinc-300"
        }`}
      >
        efficiency {on ? "on" : "off"}
      </button>
      {on && data && (
        <>
          {data.pastCliff && (
            <span className="text-amber-400">
              −{fmtUSD(data.premiumPerTurn)}/turn past the cliff
            </span>
          )}
          {data.bledTotal > 0 && (
            <span className="text-zinc-500">
              bled{" "}
              <span className="text-amber-400/90">{fmtUSD(data.bledTotal)}</span>{" "}
              this session
            </span>
          )}
          {data.compactionCount > 0 && (
            <span className="text-zinc-500">
              {data.compactionCount} compaction
              {data.compactionCount > 1 ? "s" : ""} · −{fmtTok(data.trimmedTokens)}{" "}
              · saving{" "}
              <span className="text-emerald-300">
                {fmtUSD(data.savedPerTurn)}/turn
              </span>
            </span>
          )}
          {data.bledTotal === 0 &&
            data.compactionCount === 0 &&
            !data.pastCliff && (
              <span className="text-zinc-600">
                lean — under the cliff, nothing wasted
              </span>
            )}
        </>
      )}
    </div>
  );
}
