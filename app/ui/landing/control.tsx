import { Section, SectionHead, SpinRing } from "./primitives";
import type { Spec } from "./spec-drawer";

const SPECS: Spec[] = [
  {
    n: "3.1",
    title: "The warm REPL daemon",
    desc: <>A unix-socket daemon owns the session pool, so warm sessions survive server restarts. hq&apos;s send box types into a session that is already running.</>,
    file: "lib/repl-daemon.mjs",
  },
  {
    n: "3.2",
    title: "channel-in",
    desc: <>An MCP channel pushes your message into a live terminal session in real time — <span className="text-zinc-200">no fork, one transcript</span>. Terminal-to-hq-and-back is one conversation.</>,
  },
  {
    n: "3.3",
    title: "Drives agent teams",
    desc: <>tmux teammates take real keystrokes; in-process teammates take mailbox messages. Either way the pane you&apos;re reading is the pane you&apos;re driving.</>,
    file: "lib/team-tmux.ts",
  },
  {
    n: "3.4",
    title: "Why not --resume",
    desc: <><span className="font-mono text-zinc-300">claude --resume</span> forks from the on-disk transcript — it never attaches to the running process. hq refuses to split your history in two.</>,
  },
];

// The differentiator, shown not told: a message typed in hq's send-box lands in the
// live terminal (the orange "thinking" ring reappears here — same vocabulary as the
// state section). Two framed panels, one arrow, one live session.
export default function Control() {
  return (
    <Section id="control">
      <SectionHead
        n="3.0"
        name="Control"
        title={
          <>
            It doesn&apos;t just watch.
            <br />
            <span className="text-zinc-500">It writes back.</span>
          </>
        }
        desc={
          <>
            Type from hq and it lands in the live terminal — <span className="text-zinc-200">no fork, one transcript</span>.
            A warm REPL drives the same session, so terminal-to-hq-and-back is one conversation.
          </>
        }
        specs={SPECS}
      />
      <div className="mt-14 flex flex-col items-stretch gap-6 lg:flex-row lg:items-center lg:gap-8">
        <div className="relative flex-1 rounded-xl border-2 border-blue-600 bg-blue-600/[0.06] p-7">
          <span className="absolute -top-3.5 left-6 inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 font-mono text-sm text-white">
            <span className="size-1.5 rounded-full bg-white" />
            send-box
          </span>
          <div className="pt-1 font-mono text-base text-zinc-200 sm:text-lg">
            <span className="text-blue-300">you@hq</span> ❯ refactor the auth guard
            <span
              className="ml-1 inline-block h-5 w-2.5 -translate-y-0.5 bg-blue-500 align-middle"
              style={{ animation: "hq-cursor 1.1s steps(1) infinite" }}
            />
          </div>
        </div>
        <div aria-hidden className="text-center font-mono text-3xl text-blue-500 lg:text-4xl">
          →
        </div>
        <div className="relative flex-1 overflow-hidden rounded-xl border-2 border-orange-500 p-7">
          <span className="absolute -top-3.5 left-6 z-[2] inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-1.5 font-mono text-sm text-white">
            <span className="size-1.5 rounded-full bg-white" />
            terminal-1
          </span>
          <SpinRing from="#fbbf24" to="#fb923c" dur="1.6s" radius="13px" />
          <div className="pt-1 font-mono text-base text-zinc-400 sm:text-lg">
            <span className="text-orange-400">claude</span> ⠿ editing guard.ts
            <br />
            <span className="text-zinc-600">running in the same live session</span>
          </div>
        </div>
      </div>
    </Section>
  );
}
