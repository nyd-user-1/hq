import type { CSSProperties, ReactNode } from "react";
import { SpinRing } from "./primitives";

// A faithful, STATIC hq terminal pane — the building block of the state wall. Same
// anatomy as the live hero terminal (terminal-demo.tsx) and the real app: dashed
// boundary + state-colored chip, ● activity dot + project · session · ctx/cache
// header, a transcript of tool steps, a turn-state status line, and the send-box
// footer. The border color IS the state (blue active · orange thinking · green done).

export type PaneState = "active" | "thinking" | "done";

const STATE: Record<
  PaneState,
  { border: string; chipBg: string; ring?: [string, string]; dot: string }
> = {
  active: { border: "#2563eb", chipBg: "#2563eb", dot: "bg-green-500" },
  thinking: { border: "#f97316", chipBg: "#ea580c", ring: ["#fbbf24", "#fb923c"], dot: "animate-pulse bg-green-500" },
  done: { border: "#22c55e", chipBg: "#16a34a", ring: ["#86efac", "#22c55e"], dot: "bg-green-500" },
};

export function ToolStep({ kind, children, tok }: { kind: string; children: ReactNode; tok?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-zinc-800/80 bg-zinc-900/30 px-2.5 py-2 text-[11px]">
      <span className="text-zinc-600">›</span>
      <span className="text-zinc-500">{kind}</span>
      <span className="min-w-0 flex-1 truncate text-zinc-300">{children}</span>
      {tok && <span className="shrink-0 text-zinc-600">{tok}</span>}
    </div>
  );
}

export default function TerminalPane({
  label,
  state,
  session,
  meta,
  status,
  children,
}: {
  label: string;
  state: PaneState;
  session: string;
  meta: ReactNode; // right side of the header (ctx NN% / cache MM:SS / idle …)
  status: ReactNode; // the turn-state status line above the send box
  children: ReactNode; // transcript
}) {
  const st = STATE[state];
  const style: CSSProperties = { borderColor: st.border, background: "#09090b" };
  return (
    <div className="boundary-flash relative flex min-w-0 flex-col rounded-lg border border-dashed p-3.5 pt-6 font-mono" style={style}>
      <span
        className="absolute -top-2.5 left-4 z-20 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] text-white"
        style={{ background: st.chipBg }}
      >
        <span className="size-1.5 rounded-full bg-white/90" />
        {label}
      </span>
      {st.ring && <SpinRing from={st.ring[0]} to={st.ring[1]} dur="2.2s" radius="9px" />}

      <div className="flex items-center gap-2.5 border-b border-zinc-800 pb-2.5 text-[11px]">
        <span className={`size-2 rounded-full ${st.dot}`} />
        <span className="text-zinc-300">hq</span>
        <span className="min-w-0 truncate text-green-400">{session}</span>
        <span className="ml-auto shrink-0 text-zinc-500">{meta}</span>
      </div>

      <div className="flex flex-col gap-2 py-3 text-[11px] leading-relaxed">{children}</div>

      <div className="mt-auto flex items-center gap-2 border-t border-zinc-800/70 pt-2.5 text-[11px]">
        {status}
      </div>
    </div>
  );
}
