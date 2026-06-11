import Boundary from "@/app/ui/boundary";
import TerminalForm from "@/app/ui/terminal-form";
import { recentTurns } from "@/lib/transcript";

// The session, graduated out of the terminal: verbatim last exchanges from
// the live transcript, plus an input that continues the conversation via
// `claude -p --resume` on this machine.
export default function Terminal() {
  const turns = recentTurns(3);
  const awaitingReply = turns[turns.length - 1]?.role === "user";

  return (
    <Boundary label="terminal.tsx">
      <div className="flex flex-col gap-4">
        {turns.length === 0 && (
          <p className="text-sm text-zinc-600">no session transcript found</p>
        )}
        {turns.map((t, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              <span
                className={`mr-1.5 normal-case ${
                  t.role === "user" ? "text-blue-500" : "text-orange-500"
                }`}
              >
                ●
              </span>
              {t.role === "user" ? "brendan" : "claude"}
              {t.at && (
                <span className="ml-2 normal-case tracking-normal text-zinc-600">
                  {new Date(t.at).toLocaleTimeString()}
                </span>
              )}
            </span>
            <div
              className={`scrollbar-none max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-xs leading-relaxed ${
                t.role === "user"
                  ? "border-zinc-700 bg-zinc-900 text-zinc-100"
                  : "border-zinc-800 bg-zinc-900/40 text-zinc-300"
              }`}
            >
              {t.text}
            </div>
          </div>
        ))}
        {awaitingReply && (
          <p className="font-mono text-xs text-zinc-500">claude is working…</p>
        )}
        <TerminalForm />
      </div>
    </Boundary>
  );
}
