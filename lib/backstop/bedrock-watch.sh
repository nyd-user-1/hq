#!/bin/bash
# Bedrock unlock watcher. Probes the gated Claude models every launchd interval
# and raises a macOS notification the moment any of them changes state.
# Free while blocked: a throttled or denied converse call bills nothing. Once a
# model goes LIVE it is no longer probed (sticky), so this never accrues cost.
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:$PATH"
DIR="$HOME/.claude/hq"
STATE="$DIR/bedrock-watch.state"
LOG="$DIR/bedrock-watch.log"
REGION="us-east-2"
MODELS="us.anthropic.claude-sonnet-4-6 us.anthropic.claude-sonnet-5 us.anthropic.claude-opus-4-8"
MSG='[{"role":"user","content":[{"text":"Reply with exactly: OK"}]}]'

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
notify() { osascript -e "display notification \"$2\" with title \"$1\" sound name \"Glass\"" 2>/dev/null; }

touch "$STATE"
CHANGED=0
SUMMARY=""

for M in $MODELS; do
  PREV=$(grep "^$M=" "$STATE" | cut -d= -f2)
  # Sticky: once live, stop probing (a live probe costs money; a blocked one doesn't).
  if [ "$PREV" = "LIVE" ]; then SUMMARY="$SUMMARY $M=LIVE(sticky)"; continue; fi

  OUT=$(aws bedrock-runtime converse --region "$REGION" --model-id "$M" \
        --messages "$MSG" --inference-config '{"maxTokens":16}' \
        --cli-read-timeout 30 --output json 2>&1)
  if echo "$OUT" | grep -q '"stopReason"'; then CUR="LIVE"
  elif echo "$OUT" | grep -q "ThrottlingException"; then CUR="THROTTLED"
  elif echo "$OUT" | grep -q "AccessDeniedException"; then CUR="DENIED"
  else CUR="ERROR"; log "$M unexpected: $(echo "$OUT" | head -c 200)"; fi

  SUMMARY="$SUMMARY $M=$CUR"
  if [ -n "$PREV" ] && [ "$CUR" != "$PREV" ]; then
    CHANGED=1
    log "STATE CHANGE $M: $PREV -> $CUR"
    case "$CUR" in
      LIVE)      notify "Bedrock: $M is LIVE" "Quota landed — the model answers. /backstop bedrock path is unblocked." ;;
      THROTTLED) notify "Bedrock: $M entitlement landed" "Was $PREV, now throttled-only — quota is the last gate." ;;
      *)         notify "Bedrock: $M changed" "$PREV -> $CUR" ;;
    esac
  fi
  grep -v "^$M=" "$STATE" > "$STATE.tmp" 2>/dev/null; mv "$STATE.tmp" "$STATE"
  echo "$M=$CUR" >> "$STATE"
done

log "probe:$SUMMARY changed=$CHANGED"
