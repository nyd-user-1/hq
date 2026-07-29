# HQ + the 44B worker box — agents off the laptop, one window to watch them all

**Written:** 2026-07-29 by the 44B lead, at Brendan's direction. **Status: SPEC — three
posture rulings needed before any build (§3).** Companion analysis:
`~/Code/44b/docs/reports/2026-07-29-hq-lessons.md`. Box manual:
`~/Code/44b/docs/WORKER-BOX.md` (instance `i-030d9cac100e6e124`, t4g.large, us-east-1,
stopped-by-default, SSH from Brendan's IP only).

## 1. The problem this solves

Running the 44B lane method takes 4–6 concurrent Claude Code sessions. Each is a Node
process; five of them put an 8 GB MacBook Air at 7.07 GB used with swap moving (measured
2026-07-29, 01:46). The sessions must stay *visible* — subagents are banned in the 44B
protocol precisely because Brendan can't watch them — so the fix cannot be "hide the
workers." It has to be "move the processes, keep the glass."

## 2. The architecture

**Workers run in tmux panes on an AWS box; HQ runs beside them as the mirror; the laptop
holds one SSH window and one browser tab.**

```
laptop                          agent box (AWS)
──────                          ───────────────
lead session (Claude Code) ───┐ tmux session "lanes"
                              │   pane 0: lane-40  (claude TUI)
one terminal window:          │   pane 1: lane-u   (claude TUI)
  ssh -t <box> tmux attach ───┤   pane 2: lane-ak  (claude TUI)
                              │   …
one browser tab:              │ HQ (localhost:3002, reads box ~/.claude)
  localhost:3002 ─── ssh -L ──┘
```

- Every worker is a real `claude` TUI in a pane — visible, scrollable, drivable. The
  tmux grid IS the observability; nothing is hidden.
- HQ runs on the box (`npx @nysgpt/hq` / global install), bound to 127.0.0.1 as always.
  Its localhost-only, no-auth design survives unchanged because the **SSH tunnel makes it
  local**: `ssh -L 3002:localhost:3002`. HQ reads the box's `~/.claude` — transcripts,
  session status, usage — exactly as it reads the laptop's today.
- The lead stays on the laptop and gains a *drive* path it has never had: HQ's
  `lib/team-tmux.ts` pattern — `tmux capture-pane -p -t <pane>` to read any worker's live
  terminal, `tmux send-keys -t <pane> -l "<kickoff>"` to type into its real stdin. Over
  SSH, that ends kickoff-pasting: the lead writes the brief, Brendan approves, one command
  delivers it to the right pane.
- Claude Code's experimental agent-teams tmux mode (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
  — rosters + per-member mailboxes, see `lib/teams.ts` / `lib/mailbox.ts`) is a **phase-2
  option layered on this, not a prerequisite**. Plain panes deliver the win; teams mode
  adds native lead/mailbox semantics at the cost of an experimental flag.

## 3. The three posture rulings (Brendan, before any build)

1. **An Anthropic credential lands on a cloud box.** The 44B harvest box's deliberate
   guarantee is "cannot spend on inference" — agent sessions break that by definition.
   Options: **(a) a second, dedicated agent box** so the harvest box's guarantee survives
   untouched (recommended); (b) the existing box does double duty and the guarantee is
   retired knowingly. Either way: token via `claude setup-token`, stored mode 600, spend
   limits set on the Anthropic side, box firewalled to SSH-from-Brendan's-IP as today.
2. **Writable git.** The harvest box's deploy key is read-only by design; workers must
   push commits and reports. Ruling: a second, *writable* deploy key on the agent box
   (keep the harvest box's read-only), or a GitHub machine user. Blast radius: one repo.
3. **Sizing / money.** Claude sessions want ~0.5–1 GB each. Options at us-east-1
   on-demand: resize the existing box to `t4g.xlarge` (16 GiB, ~$0.134/hr; ~$98/mo if
   never stopped) vs a second `t4g.large` for agents (~$49/mo 24×7, ~$0.067/hr) beside
   the harvest box. Agents-box hours track working hours, not harvest hours — with the
   stop-when-idle discipline this is tens of dollars a month, not hundreds.

## 4. Build steps (one session, ~an afternoon, after the rulings)

1. Provision per ruling 3 (clone the harvest box's pattern: Ubuntu 24.04 ARM, Node 22,
   security group, self-stop IAM role; `tmux` and `mosh` via apt).
2. `npm i -g @anthropic-ai/claude-code @nysgpt/hq` (both ship linux-arm64-clean).
3. Auth per ruling 1; verify `claude -p 'say ok'` completes and the token file is 600.
4. Writable clone of `44b` per ruling 2 (full clone, not shallow — workers rebase).
   `.env.local` with exactly the credentials lanes need, enumerated in the build report —
   an *agent* box legitimately carries more than the harvest box; list every key and why.
5. HQ as a service: a tmux pane running `hq` is enough for the pilot; a systemd user unit
   if it earns permanence. Bound to 127.0.0.1 — verify with `ss -tlnp`.
6. Laptop ergonomics — one alias:
   `alias lanes='ssh -t -L 3002:localhost:3002 -i ~/.ssh/44b-worker.pem ubuntu@$IP "tmux new -A -s lanes"'`
   One window, whole grid, HQ tab on localhost:3002. `mosh` instead of ssh if the
   connection drops annoy.
7. Lead monitoring: the box's `~/.claude/sessions/*.json` + transcripts, read over SSH —
   the same kit the lead uses locally (44B memory `lane-monitoring-via-session-files`).

## 5. Pilot and acceptance

Run ONE low-stakes lane end-to-end on the box (a docs or read-only spike):
- kickoff delivered by `send-keys` from the lead, not paste;
- worker commits + pushes its report from the box;
- Brendan follows it live in the tmux grid and in HQ with no laptop RAM cost beyond the
  SSH window (measure Activity Monitor before/after);
- the lane's wall-clock and friction compared honestly against the same lane run locally.
Adopt for the fleet only if the pilot beats the laptop on RAM *and* doesn't lose on
visibility or Brendan-effort. Two honest risks to watch: the CLI's on-disk shapes HQ
reads are unstable internals (HQ pins "verified on disk" for a reason), and the teams
flag — if used — is experimental and may change under us.
