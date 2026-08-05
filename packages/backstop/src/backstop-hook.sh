#!/bin/bash
# UserPromptSubmit hook for /backstop.
#
# Fires client-side the instant the prompt is submitted, BEFORE any request
# reaches the API — which is what makes it work at the wall, where the model
# cannot answer. It flips the gateway and blocks the prompt, so the whole
# interaction costs zero tokens and prints one line in the terminal.
#
# Exit 2 = block the prompt; stderr is shown to the user.
IN=$(cat)

# Extract the prompt field from the hook payload.
prompt=$(printf '%s' "$IN" | sed -n 's/.*"prompt"[[:space:]]*:[[:space:]]*"\(.*\)"[^"]*}[[:space:]]*$/\1/p')
[ -z "$prompt" ] && prompt=$(printf '%s' "$IN" | sed -n 's/.*"prompt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

# Only the literal command, at the very start of the prompt. Anything else —
# talking *about* backstop, a file that mentions it — must pass through
# untouched, or the hook would eat ordinary conversation.
case "$prompt" in
  /backstop|/backstop\ *|/backstop\\n*) args=${prompt#/backstop} ;;
  # /reload-N tops up the pass from the terminal. It only exists as its own
  # command because the moment it is needed — mid-sprint, out of budget — is the
  # worst possible moment to go looking for a dashboard.
  /reload-5|/reload-5\ *|/reload-5\\n*) args="reload-5" ;;
  /reload-10|/reload-10\ *|/reload-10\\n*) args="reload-10" ;;
  /reload-20|/reload-20\ *|/reload-20\\n*) args="reload-20" ;;
  *) exit 0 ;;
esac

# Resolve siblings from where this script actually lives, not from $HOME. The
# installer puts the hook and the control script in the same directory, and the
# hook is always invoked by absolute path — so its own location is the one
# signal that is exact. Hardcoding $HOME/.claude sent a CLAUDE_CONFIG_DIR
# session looking in the primary account's directory, where the answer is either
# missing or, worse, another account's gateway.
HERE="$(cd "$(dirname "$0")" && pwd)"
CTL="${HQ_BACKSTOP_CTL:-$HERE/backstop-ctl.sh}"
[ -x "$CTL" ] || CTL="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hq/backstop/backstop-ctl.sh"
[ -x "$CTL" ] || CTL="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hq/backstop-ctl.sh"

if [ ! -x "$CTL" ]; then
  echo "backstop: control script missing at $CTL — reinstall with: $(cat "$HERE/how" 2>/dev/null || echo "npx @nysgpt/backstop")" >&2
  exit 2
fi

out="$("$CTL" "$args" 2>&1)"

# TWO WAYS TO STOP A PROMPT, AND THEY LOOK NOTHING ALIKE.
#
# exit 2 is the obvious one, and it is what this used to do. It works — zero
# tokens, the model is never called — but Claude Code frames stderr as a
# failure: a "UserPromptSubmit operation blocked by hook" banner, the full path
# to this script, and an echo of the original prompt. Four lines of apparatus
# around one line of ours. Nothing here failed, so nothing should say it did.
#
# `continue: false` stops the turn just as hard, and `stopReason` is documented
# as shown to the user and NOT to Claude — the same guarantee, without the
# error framing.
#
# The catch is that JSON is only read on exit 0, and on THIS event a stdout that
# does not parse is handed to the model as context — that is, a malformed line
# here silently turns a local, free command into a billed model turn at exactly
# the moment the user has no budget left. So the JSON is built by node
# (JSON.stringify, not string-mashing) and anything that goes wrong falls back
# to the exit-2 path, which is merely ugly.
if [ -n "$out" ] && command -v node >/dev/null 2>&1; then
  # Our own colour comes off: the TUI styles this text itself, and a raw escape
  # byte is not legal inside a JSON string.
  plain="$(printf '%s' "$out" | sed $'s/\033\\[[0-9;]*m//g')"
  if json="$(printf '%s' "$plain" | node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d));
      process.stdin.on("end", () => {
        s = s.replace(/^\n+|\s+$/g, "");
        if (!s) process.exit(1);
        process.stdout.write(JSON.stringify({ continue: false, stopReason: s }));
      });
    ' 2>/dev/null)" && [ -n "$json" ]; then
    printf '%s' "$json"
    exit 0
  fi
fi

printf '%s\n' "$out" >&2
exit 2
