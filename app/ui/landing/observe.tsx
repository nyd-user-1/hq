import { Section, SectionHead } from "./primitives";
import TerminalPane, { ToolStep } from "./terminal-pane";

// OBSERVE — hq's signature "money shot", the multi-session wall (the real ?wall view).
// Two live panes side by side in different turn-states so the value reads instantly:
// the border IS the status. Faithful to the running app — same boundary, chip, tool
// steps, and status lines you'd see in terminal-1 / terminal-2.
export default function Observe() {
  return (
    <Section id="observe">
      <SectionHead
        n="1.0"
        name="Observe"
        title={
          <>
            Every session reports in.
            <br />
            <span className="text-zinc-500">The border is the status.</span>
          </>
        }
        desc={
          <>
            Run four terminals at once and glance to know. Blue is focused, orange is thinking,
            green just shipped, red stopped — the pane&apos;s own border carries the state, no dashboard to read.
          </>
        }
      />
      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        <TerminalPane
          label="terminal-1"
          state="thinking"
          session="landing-page"
          meta="ctx 49%"
          status={
            <span className="text-orange-400">
              <span className="text-orange-400/80">✳</span> Cooking… <span className="text-zinc-500">(6m 47s · ↑ 24.2k tokens · thinking)</span>
            </span>
          }
        >
          <div className="rounded-md bg-zinc-900/40 px-2.5 py-2 text-zinc-400">
            <span className="text-blue-400">you</span> ❯ finish the hq version of the linear landing
          </div>
          <ToolStep kind="READ" tok="~1.5k tok">terminal.tsx</ToolStep>
          <ToolStep kind="WRITE">observe.tsx</ToolStep>
          <ToolStep kind="WRITE">usage-cost.tsx</ToolStep>
          <ToolStep kind="EDIT">root-landing.tsx <span className="text-emerald-400">+82</span> <span className="text-red-400">−31</span></ToolStep>
        </TerminalPane>

        <TerminalPane
          label="terminal-2"
          state="done"
          session="remote-control-tr…"
          meta="cache 4:14"
          status={
            <span className="text-emerald-400/90">
              <span className="text-zinc-500">◦</span> idle — nothing running · last activity just now
            </span>
          }
        >
          <div className="rounded-md bg-zinc-900/40 px-2.5 py-2 text-zinc-400">
            <span className="text-emerald-400">✓</span> Console consolidation shipped — 8 panels, one container.
          </div>
          <ToolStep kind="BASH">git push origin main</ToolStep>
          <ToolStep kind="AGENT">Add embedded prop to plugins-panel</ToolStep>
          <ToolStep kind="AGENT">Add embedded prop to mcp-panel</ToolStep>
          <ToolStep kind="EDIT">shell.tsx <span className="text-emerald-400">+9</span></ToolStep>
        </TerminalPane>
      </div>
      <p className="mt-5 font-mono text-xs text-zinc-600">
        the real <span className="text-zinc-400">?wall</span> view — up to four controlled panes, each a live session
      </p>
    </Section>
  );
}
