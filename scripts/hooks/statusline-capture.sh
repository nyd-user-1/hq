#!/bin/sh
# HQ statusline capture — a Claude Code statusLine command.
#
# WHY: Claude Code pipes a rich JSON to the status line on stdin every assistant
# message — including the REAL rate-limit windows (rate_limits.five_hour /
# seven_day), session cost, and exact context usage. Those rate-limit windows are
# parsed from API headers in-process and NEVER otherwise reach disk, so HQ (a
# disk reader) can't see them. This command tees that JSON to
# ~/.claude/hq/statusline-snapshot.json, which lib/usage.ts overlays onto the
# /usage meters as the "live" source — fresher AND free vs the paid SessionStart
# probe (scripts/hooks/usage-capture.mjs), which then self-skips while this keeps
# the snapshot warm. It still renders a normal status line, so you lose nothing.
#
# ENABLE: point your statusLine at it in ~/.claude/settings.json (use the
# absolute path to wherever HQ is installed; the CMD panel prints the exact one
# for your machine):
#   "statusLine": { "type": "command",
#     "command": "sh /path/to/hq/scripts/hooks/statusline-capture.sh" }
# If you already have a statusLine command, inline this tee into it instead of
# replacing it — both can feed HQ.

input=$(cat)

# Tee the full session JSON to disk — atomic + best-effort; the render below
# always runs regardless of whether the write succeeds.
hq_dir="$HOME/.claude/hq"
if [ -d "$hq_dir" ]; then
  printf '%s' "$input" > "$hq_dir/.statusline-snapshot.tmp" 2>/dev/null &&
    mv -f "$hq_dir/.statusline-snapshot.tmp" "$hq_dir/statusline-snapshot.json" 2>/dev/null
fi

# Render: model · dir · ctx% (remaining_percentage mirrors the CLI's readout).
model=$(echo "$input" | jq -r '.model.display_name // ""')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')
dir=$(basename "$cwd")
[ -z "$dir" ] && dir="~"
if [ -n "$remaining" ]; then
  ctx=" | ctx $(printf '%.0f' "$remaining")%"
else
  ctx=""
fi
printf "%s | %s%s" "$model" "$dir" "$ctx"
