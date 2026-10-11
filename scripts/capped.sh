#!/usr/bin/env bash
# Run a command niced (19, ionice idle), with a wall-clock timeout and an RSS watchdog (kills the process
# group above MAX_RSS_MB, default 2048). Usage: TTL=30m scripts/capped.sh <cmd...>
set -uo pipefail
TTL=${TTL:-30m}; MAX_MB=${MAX_RSS_MB:-2048}
setsid timeout --signal=TERM --kill-after=20s "$TTL" nice -n 19 ionice -c3 "$@" &
PID=$!
( while kill -0 $PID 2>/dev/null; do
    rss=$(ps -o rss= -g $PID 2>/dev/null | awk '{s+=$1} END {print int(s/1024)}')
    if [ "${rss:-0}" -gt "$MAX_MB" ]; then echo "capped.sh: RSS ${rss}MB > ${MAX_MB}MB, killing" >&2; kill -KILL -- -$PID; fi
    sleep 2
  done ) &
W=$!
trap 'kill -TERM -- -$PID 2>/dev/null' INT TERM
wait $PID; RC=$?
kill $W 2>/dev/null; exit $RC
