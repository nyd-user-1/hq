#!/bin/bash
# hq backstop — client-side control.
#
# This runs entirely on the machine: no model call, no tokens, and it works
# when the API is refusing every request. That is the whole point — at the wall
# the model cannot answer, so the thing that unfreezes the sessions must not
# need it.
#
#   /backstop          toggle — engage if released, release if engaged
#   /backstop off      always release
#   /backstop force    engage without the preflight check
#   /backstop status   report
PORT="${HQ_BACKSTOP_PORT:-3141}"
BASE="http://127.0.0.1:${PORT}/_backstop"

arg="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]/')"

# Pull one string/number field out of a small JSON object without jq.
field() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/p" | head -1; }
# Same, but for prose values that may contain commas.
text() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }

if ! out=$(curl -s --max-time 5 "${BASE}/status" 2>/dev/null) || [ -z "$out" ]; then
  echo "backstop: gateway is not answering on 127.0.0.1:${PORT}."
  echo "          start it with:  launchctl kickstart -k gui/$(id -u)/com.hq.backstop"
  exit 1
fi

mode=$(field "$out" mode)

# A bare /backstop toggles. One command to reach for at the wall, and the same
# one command to get back — no need to remember which half you are in.
if [ -z "$arg" ]; then
  if [ "$mode" = "on" ]; then arg="off"; else arg="on"; fi
fi

# Yellow. One line. Back to work.
#
# Everything the swap does is meant to be invisible; the ONLY moment that earns
# a line is the moment money starts and the moment it stops. No provider name,
# no model, no restart notice, no instructions.
Y=$'\033[33m'; R=$'\033[0m'
note() { printf '\n  %s%s%s\n\n' "$Y" "$1" "$R"; }

engage() {
  if [ "$1" = "force" ]; then
    body='{"reason":"/backstop force","force":true}'
  else
    body='{"reason":"/backstop"}'
  fi
  # The preflight makes a real upstream call, so allow for a slow one.
  resp=$(curl -s --max-time 30 -X POST "${BASE}/on" -H 'content-type: application/json' -d "$body")

  if [ "$(field "$resp" ok)" = "true" ]; then
    note "Backstop engaged"
    return
  fi

  # Out of funds is the one refusal with a way forward, so it is the one
  # refusal that says anything more than why.
  reason=$(text "$resp" reason)
  case "$(field "$resp" code)" in
    no_funds)
      printf '\n  %sBackstop has no balance.%s\n' "$Y" "$R"
      printf '  %sType /reload-5 or /reload-10 to add $5 or $10 and keep going.%s\n\n' "$Y" "$R"
      ;;
    *)
      printf '\n  %sBackstop unavailable — %s%s\n\n' "$Y" "$reason" "$R"
      ;;
  esac
}

case "$arg" in
  off|stop|release|down)
    curl -s --max-time 5 -X POST "${BASE}/off" >/dev/null
    note "Backstop disengaged"
    ;;

  force)
    engage force
    ;;

  status|info)
    prov=$(field "$out" provider)
    spent=$(field "$out" spentUsd); reqs=$(field "$out" requests)
    plan=$(field "$out" planStatus); last=$(field "$out" lastLimitAt)
    degraded=$(field "$out" degraded); err=$(text "$out" lastDriverError)
    if [ "$mode" = "on" ]; then
      printf '\n  ◆ backstop ENGAGED via %s — $%.4f drawn over %s requests.\n' "$prov" "${spent:-0}" "${reqs:-0}"
      [ "$degraded" = "true" ] &&
        printf '     ! upstream is failing — requests are falling back to your own plan.\n'
    else
      printf '\n  ◇ backstop standing by (%s) — you are on your own plan.\n' "${prov:-bedrock}"
      [ -n "$spent" ] && [ "$spent" != "0" ] && printf '     lifetime drawdown: $%.4f over %s requests\n' "$spent" "${reqs:-0}"
    fi
    [ -n "$plan" ] && printf '     plan signal: %s\n' "$plan"
    [ -n "$last" ] && printf '     last wall hit: %s\n' "$last"
    [ -n "$err" ] && printf '     last upstream error: %s\n' "$err"
    printf '\n'
    ;;

  *)
    engage
    ;;
esac
